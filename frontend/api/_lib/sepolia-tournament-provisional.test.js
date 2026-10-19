import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,stat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { fixture,addr,hash } from './sepolia-tournament-test-fixture.js';
import { planHash } from './sepolia-tournament.js';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';
import { buildTournamentFinalScores } from './sepolia-tournament-final.js';
import { buildPenalty } from './points-tournament-leaderboard.js';
import { buildTournamentProvisionalScores,verifyProvisionalAnchor,validateProvisionalResult } from './sepolia-tournament-provisional.js';
import { tournamentProvisionalStore } from './sepolia-tournament-provisional-store.js';
import { SEPOLIA_TOURNAMENT_SCHEMA,tournamentStore } from './sepolia-tournament-store.js';
import { publicProvisionalStandings,readProvisionalStandings } from './sepolia-tournament-presentation.js';
import { createTournamentResultsHandler } from '../points/tournament-results.js';
import { standingsCommand } from '../scripts/onchain-sepolia-standings.mjs';

async function ongoingFixture({resolved=false,planOptions={},configure=()=>{}}={}) {
  const f=fixture({resolved,planOptions:{startsAt:'2020-11-01T06:00:00Z',endsAt:'2099-12-01T06:00:00Z',...planOptions}});
  const plan=f.input.cycle.plan,start=Date.parse(plan.startsAt)/1000;
  f.block=n=>({number:n,hash:hash(n),timestamp:start+(n>=180?3*86400+3600:0)+n-100});
  f.options.provider.getBlock=async n=>f.block(n);
  configure(f);
  const artifact=await buildTournamentSnapshot(f.input,f.options);
  const context={version:1,cycleId:plan.cycleId,planHash:planHash(plan),scoringStartsAt:plan.startsAt,operationCloseAt:plan.endsAt,
    users:[{username:'alice',createdAt:'2020-10-01T00:00:00Z'}],
    markets:[{pool:addr(40),pointsMarketId:10,exposureGroupId:10,touchMarket:false},
      {pool:addr(41),pointsMarketId:11,exposureGroupId:11,touchMarket:false}]};
  const args={artifact,context,reviewedSnapshotHash:artifact.snapshotHash,reviewedContextHash:planHash(context),
    now:new Date(Date.parse(artifact.snapshot.asOf.timestamp)+60000)};
  const result=buildTournamentProvisionalScores(args);
  return {...f,args,result,plan,season:{cycle:f.input.cycle,closure:null}};
}
const envFor=plan=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',
  ONCHAIN_CHAIN_ID:'421614',ONCHAIN_TOURNAMENT_SEASON_ENABLED:'true',ONCHAIN_TOURNAMENT_CYCLE_ID:plan.cycleId,
  DATABASE_URL:'postgres://local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_RPC_URL:'https://rpc.invalid',ONCHAIN_COLLATERAL_ADDRESS:plan.deployment.token,
  ONCHAIN_MARKET_FACTORY_ADDRESS:plan.deployment.factoryV1,ONCHAIN_MARKET_FACTORY_V2_ADDRESS:plan.deployment.factoryV2,
  ONCHAIN_TRADING_ROUTER_ADDRESS:plan.deployment.router});
const rehash=result=>{const {resultHash,...body}=result;return {...body,resultHash:planHash(body)};};
async function setup(f) {
  const db=new PGlite(),sql=async(strings,...values)=>(await db.query(strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,''),values)).rows;
  for (const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
  await tournamentStore(sql).register(f.plan,planHash(f.plan));
  await db.exec("UPDATE sepolia_tournament_cycles SET status='funded'");
  return {db,sql,store:tournamentProvisionalStore(sql)};
}

test('ongoing scores reuse Points rules with completed-day inactivity and cannot close a season',async()=>{
  const f=await ongoingFixture(),row=f.result.rows[0];
  assert.equal(f.result.status,'provisional');assert.equal(f.result.readyForRewards,false);
  assert.equal(row.marketPnl,-13.33);assert.equal(row.qualifyingMarkets,1);assert.equal(row.qualified,false);
  const penalty=buildPenalty({user:{created_at:f.plan.startsAt},activity:{active_day_keys:['2020-11-01']},
    now:new Date(f.result.asOf.timestamp),window:f.result.window});
  assert.equal(row.inactivityPenalty,penalty.inactivityPenalty);assert.equal(row.inactiveDays,2);
  assert.equal(row.score,Math.round((row.marketPnl+row.convictionBonus-row.inactivityPenalty)*100)/100);
  assert.deepEqual(buildTournamentProvisionalScores({...f.args,now:'2026-10-19'}),f.result);
  assert.throws(()=>buildTournamentFinalScores(f.args),/reviewed_final_snapshot/);
});

test('incoming gifts cannot create provisional qualification or conviction',async()=>{
  const f=await ongoingFixture({configure:f=>f.addReceipt(hash(800),105,[f.cashLog(addr(91),addr(30),'500000000')])});
  assert.equal(f.result.rows[0].qualifyingMarkets,0);assert.equal(f.result.rows[0].convictionBonus,0);
  assert.equal(f.result.rows[0].buyCount,2); // Partly eligible buys remain activity, below the 100-MXNP qualifying minimum.
  assert.equal(f.result.rules.externalTransfers,'exclude_incoming_proportional_outgoing');
});

test('resolved winning lots earn the same Points conviction, while unverified or final captures are refused',async()=>{
  const f=await ongoingFixture({resolved:true});assert.ok(f.result.rows[0].convictionBonus>0);assert.equal(f.result.rows[0].marketPnl,145);
  for (const mutate of [a=>a.reviewedSnapshotHash='bad',a=>a.reviewedContextHash='bad',a=>a.context.users=[],
    a=>a.artifact.version=3,a=>a.artifact.readyForRewards=true,a=>a.artifact.registryHash='bad',
    a=>a.now='2020-01-01',a=>a.now=f.plan.endsAt,a=>a.artifact.scores.rows[0].pnlUnits='999999']) {
    const args=structuredClone(f.args);mutate(args);assert.throws(()=>buildTournamentProvisionalScores(args));
  }
  const args=structuredClone(f.args);args.artifact.scores.transferReconciliation.historicalBalancesVerified=false;
  const {snapshotHash,...body}=args.artifact;args.artifact.snapshotHash=planHash(body);args.reviewedSnapshotHash=args.artifact.snapshotHash;
  assert.throws(()=>buildTournamentProvisionalScores(args),/verified_transfer_capture/);
});

test('publication verifies the canonical confirmed anchor, never signs or sends transactions',async()=>{
  const f=await ongoingFixture();await verifyProvisionalAnchor(f.result,f.options.provider);
  for (const provider of [{...f.options.provider,getNetwork:async()=>({chainId:42161})},
    {...f.options.provider,getBlockNumber:async()=>200},
    {...f.options.provider,getBlock:async n=>({...f.block(n),hash:hash(999)})}]) {
    await assert.rejects(verifyProvisionalAnchor(f.result,provider),/mismatch|reorg_or_unconfirmed/);
  }
});

test('append-only publication rejects rollback, conflicting same-block results, tampering and final closure',async()=>{
  const f=await ongoingFixture(),{db,sql,store}=await setup(f);
  try {
    for (const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
    assert.equal(await store.read(f.plan.cycleId),null);
    assert.deepEqual(await store.publish(f.result),f.result);assert.deepEqual(await store.publish(f.result),f.result);
    const conflict=rehash({...f.result,label:'different'});await assert.rejects(store.publish(conflict),/not_newer/);
    const older=rehash({...f.result,asOf:{...f.result.asOf,blockNumber:199}});await assert.rejects(store.publish(older),/not_newer/);
    const next=rehash({...f.result,asOf:{blockNumber:201,blockHash:hash(201),timestamp:new Date(Date.parse(f.result.asOf.timestamp)+1000).toISOString()}});
    await store.publish(next);assert.equal((await store.read(f.plan.cycleId)).asOf.blockNumber,201);
    await assert.rejects(db.exec('DELETE FROM sepolia_tournament_standings'),/immutable/);
    await assert.rejects(db.exec("UPDATE sepolia_tournament_standings SET result_hash=repeat('0',64)"),/immutable/);
    const bad=structuredClone(next);bad.rows[0].score++;await assert.rejects(store.publish(bad),/invalid_provisional_result/);
    const final=rehash({...f.result,status:'closed',mode:'final'});
    await sql`INSERT INTO sepolia_tournament_closures(cycle_id,plan_hash,result_hash,result)
      VALUES(${final.cycleId},${final.planHash},${final.resultHash},${JSON.stringify(final)}::jsonb)`;
    await assert.rejects(store.publish(next),/season_closed/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sepolia_tournament_standings')).rows[0].n,2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sepolia_tournament_mints')).rows[0].n,0);
  } finally {await db.close();}
});

test('changed enrollment, a held/expired lease, inactive season and wrong plan prevent publishing',async()=>{
  const f=await ongoingFixture(),{db,sql,store}=await setup(f);
  try {
    const owner=f.plan.deployment.operations,lease='00000000-0000-0000-0000-000000000001';
    await tournamentStore(sql).acquire(owner,lease);await assert.rejects(store.publish(f.result),/funder_busy/);
    await tournamentStore(sql).release(owner,lease);
    await db.query(`INSERT INTO sepolia_tournament_joins(tx_hash,cycle_id,plan_hash,username,wallet_address,suborg_id,
      funder_address,nonce,amount_units,signed_tx,status) VALUES($1,$2,$3,'bob',$4,'bob',$5,0,500000000,'test','prepared')`,
      [hash(750),f.result.cycleId,f.result.planHash,addr(31),owner]);
    await assert.rejects(store.publish(f.result),/join_capture_changed/);
    await db.exec("UPDATE sepolia_tournament_joins SET status='confirmed'");await assert.rejects(store.publish(f.result),/join_capture_changed/);
    await db.exec("UPDATE sepolia_tournament_joins SET status='reverted'");
    const stolen=async(strings,...values)=>{
      if(strings.join('').includes('WITH held AS')) await db.exec("UPDATE sepolia_tournament_lock SET lease_until=now()-interval '1 second'");
      return sql(strings,...values);
    };
    await assert.rejects(tournamentProvisionalStore(stolen).publish(f.result),/lease_lost/);
    assert.equal(await store.read(f.result.cycleId),null);
    await db.exec("UPDATE sepolia_tournament_cycles SET status='prepared'");await assert.rejects(store.publish(f.result),/funded_season_required/);
    const bad=rehash({...f.result,token:addr(999)});assert.throws(()=>validateProvisionalResult(f.input.cycle,bad),/invalid/);
  } finally {await db.close();}
});

test('publication rejects a past season and a future-dated capture',async()=>{
  const ended=await ongoingFixture({planOptions:{endsAt:'2020-12-01T06:00:00Z'}}),a=await setup(ended);
  try {await assert.rejects(a.store.publish(ended.result),/not_active/);} finally {await a.db.close();}
  const f=await ongoingFixture(),b=await setup(f);
  try {
    const future=rehash({...f.result,asOf:{...f.result.asOf,timestamp:'2090-01-01T00:00:00Z'}});
    await assert.rejects(b.store.publish(future),/not_active/);
  } finally {await b.db.close();}
});

test('read-only public standings are bounded, private, timestamped, explicitly stale and preview-gated',async()=>{
  const f=await ongoingFixture(),{db,sql,store}=await setup(f),env=envFor(f.plan);
  try {
    await store.publish(f.result);
    assert.deepEqual(await readProvisionalStandings({season:f.season,env,sqlFor:()=>sql}),f.result);
    for (const change of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'},{ONCHAIN_TOURNAMENT_SEASON_ENABLED:'false'}]) {
      assert.equal(await readProvisionalStandings({season:f.season,env:{...env,...change},sqlFor:()=>assert.fail('no connection')}),null);
    }
    const result=structuredClone(f.result);result.rows=Array.from({length:27},(_,i)=>({...result.rows[0],username:i===26?'alice':`user${i}`,rank:i+1,wallet:addr(30),suborg:'private'}));result.totalParticipants=27;
    const payload=publicProvisionalStandings(result,f.season,'ALICE',f.args.now);
    assert.equal(payload.status,'provisional');assert.equal(payload.frozen,false);assert.equal(payload.freshness,'fresh');
    assert.equal(payload.top.length,20);assert.equal(payload.me.rank,27);assert.equal(payload.readyForRewards,false);
    assert.doesNotMatch(JSON.stringify(payload),/0x[0-9a-f]{40}|suborg|private|createdAt|blockHash/);
    assert.equal(publicProvisionalStandings(result,f.season,null,'2026-10-19').freshness,'stale');
    assert.equal(publicProvisionalStandings(null,f.season,null,f.args.now).totalParticipants,null);
  } finally {await db.close();}
});

test('standings HTTP response never substitutes provisional rows for finals and final closure wins refresh races',async()=>{
  const f=await ongoingFixture(),env=envFor(f.plan);
  const run=async(changes={})=>{
    const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;},end(){return this;}};
    await createTournamentResultsHandler({env,readSeason:async()=>f.season,sessionFor:()=>({username:'alice'}),
      readStandings:async()=>f.result,now:()=>f.args.now,...changes})({method:'GET',query:{action:'standings'},headers:{}},res);
    return res;
  };
  assert.equal((await run()).body.status,'provisional');assert.equal((await run()).body.me.username,'alice');
  assert.equal((await run({readStandings:async()=>null})).body.status,'pending');
  const closed={...f.result,status:'closed'};
  const final=await run({readSeason:async()=>({...f.season,closure:closed}),readStandings:()=>assert.fail('final wins')});
  assert.equal(final.body.status,'closed');assert.equal(final.body.frozen,true);
  const unavailable=await run({readStandings:()=>{throw Error('private SQL');}});assert.equal(unavailable.code,503);
  assert.deepEqual(unavailable.body,{error:'tournament_results_unavailable'});
});

test('standings command is offline by default, exports private files and rejects production publication',async()=>{
  const f=await ongoingFixture(),dir=await mkdtemp(join(tmpdir(),'pronos-provisional-'));
  try {
    const input=join(dir,'capture.json'),context=join(dir,'context.json'),output=join(dir,'result.json');
    await writeFile(input,JSON.stringify(f.args.artifact));await writeFile(context,JSON.stringify(f.args.context));
    const values={input,context,output,'reviewed-snapshot-hash':f.args.reviewedSnapshotHash,'reviewed-context-hash':f.args.reviewedContextHash};
    const deps={now:f.args.now,sqlFor:()=>assert.fail('offline'),providerFor:()=>assert.fail('offline')};
    const summary=await standingsCommand(values,deps);assert.equal(summary.published,false);
    assert.equal((await stat(output)).mode&0o777,0o600);assert.deepEqual(JSON.parse(await readFile(output,'utf8')),f.result);
    await assert.rejects(standingsCommand(values,deps),/EEXIST/);
    await assert.rejects(standingsCommand({...values,publish:true},{...deps,env:{...envFor(f.plan),VERCEL_ENV:'production'},branch:()=> 'onchain-sepolia'}),/preview_destination/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('explicit pinned-preview standings command verifies the anchor and publishes without signing',async()=>{
  const f=await ongoingFixture(),{db,sql,store}=await setup(f),dir=await mkdtemp(join(tmpdir(),'pronos-publish-'));
  try {
    const input=join(dir,'capture.json'),context=join(dir,'context.json'),output=join(dir,'result.json');
    await writeFile(input,JSON.stringify(f.args.artifact));await writeFile(context,JSON.stringify(f.args.context));
    const env=envFor(f.plan),values={input,context,output,publish:true,'reviewed-snapshot-hash':f.args.reviewedSnapshotHash,
      'reviewed-context-hash':f.args.reviewedContextHash,'expected-host':new URL(env.DATABASE_URL).hostname};
    const summary=await standingsCommand(values,{env,now:f.args.now,sqlFor:()=>sql,branch:()=> 'onchain-sepolia',providerFor:()=>f.options.provider});
    assert.equal(summary.published,true);assert.deepEqual(await store.read(f.plan.cycleId),f.result);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sepolia_tournament_mints')).rows[0].n,0);
  } finally {await db.close();await rm(dir,{recursive:true,force:true});}
});
