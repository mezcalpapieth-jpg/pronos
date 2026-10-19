import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,stat,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewFixture } from './sepolia-tournament-review-test-fixture.js';
import { planHash } from './sepolia-tournament.js';
import { addr,hash } from './sepolia-tournament-test-fixture.js';
import { buildStandingsPolicy,runStandingsTick,validateStandingsPolicy } from './sepolia-tournament-automation.js';
import { standingsAutomationStore } from './sepolia-tournament-automation-store.js';
import { buildTournamentProvisionalScores } from './sepolia-tournament-provisional.js';
import { tournamentProvisionalStore } from './sepolia-tournament-provisional-store.js';
import { automationPolicyCommand } from '../scripts/onchain-sepolia-automation.mjs';
import { ethers } from 'ethers';
import { JOIN_ABI } from './sepolia-tournament-join.js';

const policyFor=f=>buildStandingsPolicy({registry:f.input.registry,context:f.context,fromBlock:f.input.fromBlock,
  confirmations:2,reviewedRegistryHash:f.input.reviewedRegistryHash,reviewedContextHash:planHash(f.context)});
const tick=(f,changes={})=>runStandingsTick({sql:f.sql,provider:f.options.provider,policy:policyFor(f),
  reviewedPolicyHash:policyFor(f).policyHash,sourceSha:'a'.repeat(40),...changes});
test('durable capture resumes over independent invocations and publishes exactly the reviewed scorer output',async()=>{
  const f=await reviewFixture();
  try {
    const first=await tick(f,{maxRequests:5});assert.equal(first.status,'paused');
    assert.equal(await tournamentProvisionalStore(f.sql).read(f.plan.cycleId),null);
    let done;
    for(let i=0;i<40;i++){done=await tick(f,{maxRequests:5});if(done.status==='published')break;assert.equal(done.status,'paused');}
    assert.equal(done.status,'published');
    const actual=await tournamentProvisionalStore(f.sql).read(f.plan.cycleId);
    const expected=buildTournamentProvisionalScores({artifact:f.artifact,context:f.context,
      reviewedSnapshotHash:f.artifact.snapshotHash,reviewedContextHash:planHash(f.context)});
    assert.deepEqual(actual,expected);
    const [audit]=(await f.db.query('SELECT policy_hash,source_sha FROM sepolia_tournament_standings')).rows;
    assert.deepEqual(audit,{policy_hash:policyFor(f).policyHash,source_sha:'a'.repeat(40)});
    assert.equal((await tick(f)).status,'skipped'); // interval, not duplicate publication
    assert.equal((await f.db.query('SELECT balance FROM points_balances')).rows[0].balance,'12345');
    assert.equal((await f.db.query('SELECT count(*)::int n FROM sepolia_tournament_closures')).rows[0].n,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM sepolia_standings_checkpoints')).rows[0].n,0);
  } finally {await f.db.close();}
});
test('concurrent workers, expired leases and checkpoint writes are fenced',async()=>{
  const f=await reviewFixture();
  try {
    const a=standingsAutomationStore(f.sql,f.plan.cycleId),b=standingsAutomationStore(f.sql,f.plan.cycleId);
    assert.ok(await a.acquire());assert.equal(await b.acquire(),null);
    const input={private:'fixture'},checkpoint=await a.checkpoints(input);
    await checkpoint.create('manifest.json',{test:true});
    await assert.rejects(f.db.exec("UPDATE sepolia_standings_checkpoints SET payload='{}'"),/immutable/);
    await f.db.exec("UPDATE sepolia_standings_jobs SET expires_at=now()-interval '1 second'");
    assert.ok(await b.acquire());
    await assert.rejects(checkpoint.create('another.json',{test:true}),/lease_lost/);
    await assert.rejects(a.saveInput(input),/lease_lost/);await assert.rejects(a.finish('published'),/lease_lost/);
    await a.release();await b.assertHeld();await b.release();
  } finally {await f.db.close();}
});
test('canonical reorg, changed metadata and incomplete index coverage never publish partial scores',async()=>{
  const f=await reviewFixture();
  try {
    await tick(f,{maxRequests:5});
    const original=f.options.provider.getBlock;
    f.options.provider.getBlock=async n=>({...await original(n),hash:n===200?hash(999):hash(n)});
    await assert.rejects(tick(f),/reorg/);
    assert.equal((await f.db.query('SELECT input FROM sepolia_standings_jobs')).rows[0].input,null);
    f.options.provider.getBlock=original;
    await f.db.exec('UPDATE indexer_factory_state SET last_block=199');
    await assert.rejects(tick(f),/incomplete_indexer_coverage/);
    await f.db.exec('UPDATE indexer_factory_state SET last_block=200; UPDATE points_markets SET parent_id=100 WHERE id=10');
    await assert.rejects(tick(f),/market_context_changed/);
    assert.equal(await tournamentProvisionalStore(f.sql).read(f.plan.cycleId),null);
    assert.equal((await f.db.query('SELECT status FROM sepolia_standings_jobs')).rows[0].status,'error');
  } finally {await f.db.close();}
});
test('changed funding references discard the old generation and expired seasons stop',async()=>{
  const f=await reviewFixture();
  try {
    await tick(f,{maxRequests:1});const old=(await f.db.query('SELECT input FROM sepolia_standings_jobs')).rows[0].input;
    // A changed confirmed funding reference invalidates the generation before
    // any old cached receipt can be reused.
    await f.sql`UPDATE sepolia_tournament_mints SET tx_hash=${hash(999)}`;
    await assert.rejects(tick(f),/missing|receipt|transaction/);
    const changed=(await f.db.query('SELECT input FROM sepolia_standings_jobs')).rows[0].input;
    assert.notEqual(changed.generation,old.generation);
    assert.equal((await tick(f,{now:()=>new Date(f.plan.endsAt)})).status,'ended');
    assert.equal(await tournamentProvisionalStore(f.sql).read(f.plan.cycleId),null);
  } finally {await f.db.close();}
});
test('pending joins wait; a newly confirmed late participant is included automatically with a fresh capture',async()=>{
  const f=await reviewFixture({planOptions:{lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'}});
  try {
    await tick(f,{maxRequests:1});
    const grant={txHash:hash(750),wallet:addr(31),suborg:'bob',username:'bob'};
    await f.sql`INSERT INTO sepolia_tournament_joins(tx_hash,cycle_id,plan_hash,username,wallet_address,suborg_id,funder_address,nonce,amount_units,signed_tx,status)
      VALUES(${grant.txHash},${f.plan.cycleId},${planHash(f.plan)},'bob',${grant.wallet},'bob',${f.plan.deployment.operations},2,${f.plan.allocationUnits},'fixture-only','prepared')`;
    assert.equal((await tick(f)).status,'waiting_for_joins');
    assert.equal((await f.db.query('SELECT input FROM sepolia_standings_jobs')).rows[0].input,null);
    await f.sql`UPDATE sepolia_tournament_joins SET status='confirmed'`;
    await f.sql`INSERT INTO points_users VALUES('bob',${grant.wallet},'bob',NULL,'2020-10-01')`;
    const abi=new ethers.utils.Interface(JOIN_ABI);
    f.addReceipt(grant.txHash,150,[f.cashLog(f.plan.deployment.operations,grant.wallet,f.plan.allocationUnits)]);
    f.transactions.set(grant.txHash,{hash:grant.txHash,blockNumber:150,blockHash:hash(150),chainId:421614,
      from:f.plan.deployment.operations,to:f.plan.deployment.token,value:0,data:abi.encodeFunctionData('transfer',[grant.wallet,f.plan.allocationUnits])});
    assert.equal((await tick(f)).status,'published');
    const result=await tournamentProvisionalStore(f.sql).read(f.plan.cycleId);
    assert.deepEqual(new Set(result.rows.map(r=>r.username)),new Set(['alice','bob']));
    assert.equal(result.rows.find(r=>r.username==='bob').marketPnl,0);
  } finally {await f.db.close();}
});
test('policy hashes and RPC chain are checked before SQL; policy export is private, offline and exclusive',async()=>{
  const f=await reviewFixture(),dir=await mkdtemp(join(tmpdir(),'pronos-policy-'));
  try {
    const policy=policyFor(f);
    assert.throws(()=>validateStandingsPolicy({...policy,fromBlock:1},policy.policyHash),/policy/);
    await assert.rejects(tick(f,{sql:()=>assert.fail('no SQL'),reviewedPolicyHash:'bad'}),/reviewed/);
    await assert.rejects(tick(f,{sql:()=>assert.fail('no SQL'),provider:{getNetwork:async()=>({chainId:1})}}),/chain/);
    const registry=join(dir,'registry.json'),context=join(dir,'context.json'),output=join(dir,'review.json');
    await writeFile(registry,JSON.stringify(f.input.registry));await writeFile(context,JSON.stringify(f.context));
    const values={registry,context,output,'from-block':'100',confirmations:'2',
      'reviewed-registry-hash':f.input.reviewedRegistryHash,'reviewed-context-hash':planHash(f.context)};
    assert.equal((await automationPolicyCommand(values)).enabled,false);
    assert.equal((await stat(output)).mode&0o777,0o600);
    await assert.rejects(automationPolicyCommand(values),/EEXIST/);
  } finally {await f.db.close();await rm(dir,{recursive:true,force:true});}
});
test('the restricted scheduler role can publish but cannot read signing material or change Points, cycles, closures or eligibility',async()=>{
  const f=await reviewFixture();
  try {
    await f.db.exec('CREATE ROLE sepolia_standings');
    await f.db.exec(await readFile(new URL('../../../ops/onchain-sepolia-standings/schema.sql',import.meta.url),'utf8'));
    await f.db.exec('SET ROLE sepolia_standings');
    assert.equal((await tick(f)).status,'published');
    for(const query of ['SELECT wallet_address FROM points_users','SELECT signed_tx FROM sepolia_tournament_mints',
      'SELECT * FROM points_balances',"UPDATE sepolia_tournament_cycles SET status='prepared'",'DELETE FROM sepolia_tournament_closures',
      'SELECT * FROM sepolia_tournament_eligibility','DELETE FROM sepolia_tournament_standings']) {
      await assert.rejects(f.db.exec(query),/permission denied/);
    }
    await f.db.exec('RESET ROLE');
    assert.equal((await f.db.query('SELECT balance FROM points_balances')).rows[0].balance,'12345');
  } finally {await f.db.close();}
});
test('deadline pauses resume safely and the reviewed confirmation depth must still hold at publication',async()=>{
  const f=await reviewFixture();
  try {
    const paused=await tick(f,{deadline:Date.now()-1});assert.equal(paused.status,'paused');assert.equal(paused.newReads,0);
    const policy=buildStandingsPolicy({registry:f.input.registry,context:f.context,fromBlock:100,confirmations:12,
      reviewedRegistryHash:f.input.reviewedRegistryHash,reviewedContextHash:planHash(f.context)});
    let tips=0;f.options.provider.getBlockNumber=async()=>++tips<=3?211:204;
    await assert.rejects(tick(f,{policy,reviewedPolicyHash:policy.policyHash}),/confirmation_depth/);
    assert.equal(await tournamentProvisionalStore(f.sql).read(f.plan.cycleId),null);
    f.options.provider.getBlockNumber=async()=>211;
    assert.equal((await tick(f,{policy,reviewedPolicyHash:policy.policyHash})).status,'published');
  } finally {await f.db.close();}
});
