import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { buildTournamentPlan, planHash, validateTournamentPlan } from './sepolia-tournament.js';
import { SEPOLIA_TOURNAMENT_SCHEMA, tournamentStore } from './sepolia-tournament-store.js';
import { tournamentJoinStore } from './sepolia-tournament-join-store.js';
import { joinTournament, JOIN_ABI } from './sepolia-tournament-join.js';
import { lateJoinSettings, prepareTournamentJoin } from './sepolia-tournament-user-join.js';
import { fixture, addr, hash } from './sepolia-tournament-test-fixture.js';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';

const modulePath=process.env.SEPOLIA_GAS_TEST_PGLITE;
const abi=new ethers.utils.Interface(JOIN_ABI);

test('reserve is opt-in, pre-minted within the issuance cap and part of the immutable plan',()=>{
  const old=fixture().input.cycle.plan;
  assert.equal(old.version,1);assert.equal(old.lateJoinReserveUnits,undefined);validateTournamentPlan(old);
  const p=fixture({planOptions:{lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'}}).input.cycle.plan;
  assert.equal(p.version,2);assert.equal(p.totalUnits,'2000000000');assert.equal(p.liquidityUnits,'1000000000');
  assert.equal(p.batches[0].recipients.at(-1).units,'1500000000');validateTournamentPlan(p);
  assert.throws(()=>fixture({planOptions:{lateJoinReserveMxnp:'500'}}),/cap_exceeded/);
  assert.throws(()=>validateTournamentPlan({...p,lateJoinReserveUnits:'1000000000'}),/cap_exceeded/);
});

test('normal-user joining stays disabled outside the explicit isolated Sepolia runtime',async()=>{
  const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',
    ONCHAIN_CHAIN_ID:'421614',ONCHAIN_TOURNAMENT_LATE_JOIN_ENABLED:'true',ONCHAIN_TOURNAMENT_CYCLE_ID:'cycle-two',
    ONCHAIN_TOURNAMENT_FUNDER_SUBORG_ID:'operations',ONCHAIN_RPC_URL:'https://rpc.invalid',TURNKEY_POLICIES_ENABLED:'true',
    DATABASE_URL:'postgres://local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb'};
  assert.equal(lateJoinSettings(env).configured,true);
  for(const change of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'},{ONCHAIN_CHAIN_ID:'42161'},
    {ONCHAIN_TOURNAMENT_LATE_JOIN_ENABLED:'false'}]) {
    assert.equal((await prepareTournamentJoin('user',{env:{...env,...change},run:()=>assert.fail('must stay off')})).status,'disabled');
  }
  await assert.rejects(prepareTournamentJoin('user',{env:{...env,DATABASE_URL:'postgres://production/db'}}),/unavailable/);
  assert.deepEqual(await prepareTournamentJoin('user',{env,sqlFor:()=>null,providerFor:()=>null,run:async args=>{
    assert.equal(args.suborgId,'user');return {status:'registered'};
  }}),{status:'registered'});
});

test('local PostgreSQL: one-time joins reserve grants before broadcast and recover ambiguous sends', {skip:!modulePath},async t=>{
  const {PGlite}=await import(modulePath), db=new PGlite();
  const sql=async(strings,...values)=>(await db.query(strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,''),values)).rows;
  const operations=new ethers.Wallet(`0x${'34'.repeat(32)}`);
  const original=fixture().input.cycle.plan;
  const plan=buildTournamentPlan({deployment:{...original.deployment,operations:operations.address},previousDeployment:original.previousDeployment,
    users:[{username:'alice',wallet_address:addr(30),turnkey_sub_org_id:'alice'}],cycleId:'cycle-two',label:'Cycle',
    startsAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),
    liquidityMxnp:'1000',lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'});
  let nonce=0,signs=0,sends=0,mine=true;
  const receipts=new Map();
  try {
    for(const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
    await db.exec('CREATE TABLE points_users(username text,wallet_address text,turnkey_sub_org_id text)');
    for(const [name,n] of [['alice',30],['bob',31],['carol',32]]) await db.query('INSERT INTO points_users VALUES ($1,$2,$1)',[name,addr(n)]);
    const store=tournamentJoinStore(sql,tournamentStore(sql));
    await store.register(plan,planHash(plan));await db.exec("UPDATE sepolia_tournament_cycles SET status='funded'");
    const provider={getNetwork:async()=>({chainId:421614}),getCode:async()=> '0x',
      getTransactionCount:async()=>nonce,getGasPrice:async()=>ethers.BigNumber.from(10000000),
      estimateGas:async()=>ethers.BigNumber.from(50000),call:async()=>abi.encodeFunctionResult('transfer',[true]),
      getTransactionReceipt:async h=>receipts.get(h),getBlock:async()=>({hash:hash(200)}),
      sendTransaction:async signed=>{
        sends++;const tx=ethers.utils.parseTransaction(signed);
        assert.equal((await store.pendingJoin(plan.deployment.operations)).signed_tx,signed);
        if(mine&&!receipts.has(tx.hash)) {
          const [to,units]=abi.decodeFunctionData('transfer',tx.data);
          receipts.set(tx.hash,{status:1,transactionHash:tx.hash,confirmations:2,blockNumber:200,blockHash:hash(200),logs:[{
            address:plan.deployment.token,...abi.encodeEventLog(abi.getEvent('Transfer'),[operations.address,to,units]),
          }]});nonce++;
        }
        throw Error('ambiguous transport after acceptance');
      }};
    const run=(suborgId='bob',extra={})=>joinTournament({store,provider,cycleId:plan.cycleId,suborgId,
      sign:async tx=>{signs++;return operations.signTransaction(tx);},verifyRuntime:async()=>{},...extra});
    await t.test('opening users receive no second grant',async()=>{
      assert.equal((await run('alice')).opening,true);assert.equal(signs,0);
    });
    await t.test('concurrency plus response loss results in one confirmed grant and one signature',async()=>{
      const result=await Promise.allSettled([run(),run()]);
      assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(signs,1);assert.equal(sends,1);
      assert.equal((await run()).status,'registered');
      assert.equal((await run()).status,'registered');assert.equal(signs,1);assert.equal(sends,1);
    });
    await t.test('reserve exhaustion, expired window and changed wallet identity cannot broadcast',async()=>{
      await assert.rejects(run('carol'),/budget/);assert.equal(sends,1);
      await assert.rejects(run('carol',{now:new Date(Date.parse(plan.endsAt)+1)}),/window/);
      await db.query('UPDATE points_users SET wallet_address=$1 WHERE username=$2',[addr(99),'bob']);
      await assert.rejects(run(),/identity_changed/);assert.equal(sends,1);
      await db.query('UPDATE points_users SET wallet_address=$1 WHERE username=$2',[addr(31),'bob']);
    });
    await t.test('pending transaction is resumed with the same bytes, including after the window closes',async()=>{
      await db.exec('TRUNCATE sepolia_tournament_joins');receipts.clear();mine=false;
      const first=await run();assert.equal(first.status,'pending');const signed=(await store.pendingJoin(plan.deployment.operations)).signed_tx;
      mine=true;await run('bob',{now:new Date(Date.parse(plan.endsAt)+1)});
      assert.equal((await store.pendingJoin(plan.deployment.operations)).signed_tx,signed);
      assert.equal((await run()).status,'registered');
    });
    await t.test('lease fencing and SQL window guard reject stale work even with valid signed bytes',async()=>{
      await db.exec('TRUNCATE sepolia_tournament_joins');
      const e={cycleId:plan.cycleId,planHash:planHash(plan),username:'carol',wallet:addr(32),suborg:'carol',funder:plan.deployment.operations,
        nonce:500,units:plan.allocationUnits,signed:'test',hash:hash(999)};
      await assert.rejects(store.prepareJoin(e,'00000000-0000-0000-0000-000000000001'),/lease/);
      assert.equal((await sql`SELECT COUNT(*)::int AS n FROM sepolia_tournament_joins`)[0].n,0);
    });
  } finally {await db.close();}
});

test('canonical late grant activates scoring only after its receipt and cannot mutate the opening roster',async()=>{
  const f=fixture({planOptions:{lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'}}),p=f.input.cycle.plan;
  const join={planHash:planHash(p),username:'bob',wallet:addr(31),suborg:'bob',txHash:hash(750)};
  f.input.lateJoins=[join];
  f.addReceipt(join.txHash,115,[f.encoded(abi,'Transfer',[p.deployment.operations,join.wallet,p.allocationUnits],p.deployment.token)]);
  f.transactions.set(join.txHash,{hash:join.txHash,blockNumber:115,blockHash:hash(115),chainId:421614,from:p.deployment.operations,to:p.deployment.token,
    value:0,data:abi.encodeFunctionData('transfer',[join.wallet,p.allocationUnits])});
  // Activity before registration has real outside funding, which stays excluded.
  f.addReceipt(hash(749),109,[f.cashLog(p.deployment.operations,join.wallet,'100000000')]);
  for(const [n,tx] of [[111,751],[116,752]]) f.addReceipt(hash(tx),n,[f.cashLog(join.wallet,addr(40),'100000000'),
    f.shareLog(1,addr(40),join.wallet,0,'180000000',1),f.encoded(f.eventAbis[1],'SharesBought',[join.wallet,true,'100000000','1000000','180000000'],addr(40),2)]);
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>Number(index)===0?(wallet.toLowerCase()===join.wallet?200000000:50000000):0;
  const result=await buildTournamentSnapshot(f.input,f.options),bob=result.scores.rows.find(r=>r.username==='bob');
  assert.equal(bob.openingUnits,'500000000');assert.equal(bob.cashUnits,'400000000');assert.equal(bob.eventCount,1);
  assert.equal(result.scores.ignoredEvents,1);assert.equal(p.userCount,1);
  for(const change of [()=>f.input.lateJoins.push(join),()=>f.transactions.get(join.txHash).from=addr(99)]) {
    const saved=structuredClone(f.input.lateJoins);change();await assert.rejects(buildTournamentSnapshot(f.input,f.options));f.input.lateJoins=saved;
  }
});

test('operator capture reads join audit references, refuses unresolved joins and fixes its cutoff before SQL',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os'),{join}=await import('node:path');
  const {snapshotCommand}=await import('../scripts/onchain-sepolia-snapshot.mjs');
  const dir=await mkdtemp(join(tmpdir(),'pronos-join-snapshot-'));
  try {
    const f=fixture({planOptions:{lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'}}),request=join(dir,'request.json');
    await writeFile(request,JSON.stringify({cycleId:'cycle-two',asOfBlock:200,fromBlock:100,registry:f.input.registry}));
    const args={input:request,output:join(dir,'result.json'),'reviewed-plan-hash':f.input.reviewedPlanHash,'reviewed-registry-hash':f.input.reviewedRegistryHash};
    let pending=true,builds=0,anchored=false;
    const dependencies={env:{ONCHAIN_SNAPSHOT_DATABASE_URL:'postgres://reader@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
      ONCHAIN_SNAPSHOT_RPC_URL:'https://rpc.invalid'},providerFor:()=>({...f.options.provider,getBlock:async n=>{anchored=true;return f.block(n);}}),
      sqlFor:()=>async(strings)=>{
        assert.equal(anchored,true);const query=strings.join('?');assert.match(query,/^SELECT /);assert.doesNotMatch(query,/signed_tx/);
        if(query.includes('FROM sepolia_tournament_cycles'))return {rows:[f.input.cycle]};
        if(query.includes('FROM sepolia_tournament_mints'))return [{batch_index:0,tx_hash:hash(500)}];
        if(query.includes('FROM sepolia_tournament_joins'))return {rows:[{status:pending?'prepared':'confirmed',plan_hash:f.input.reviewedPlanHash,
          username:'bob',wallet_address:addr(31),suborg_id:'bob',tx_hash:hash(750)}]};
        return [];
      },buildSnapshot:async input=>{
        builds++;assert.equal(input.expectedCutoffHash,hash(200));assert.equal(input.lateJoins[0].wallet,addr(31));
        return {mode:'shadow',snapshotHash:'test',registryHash:input.reviewedRegistryHash,snapshot:{markets:[],events:[]}};
      }};
    await assert.rejects(snapshotCommand(args,dependencies),/pending_join_reconciliation/);assert.equal(builds,0);
    pending=false;await snapshotCommand(args,dependencies);assert.equal(builds,1);
  } finally {await rm(dir,{recursive:true,force:true});}
});
