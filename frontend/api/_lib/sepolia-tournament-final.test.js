import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,stat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { fixture,addr,hash } from './sepolia-tournament-test-fixture.js';
import { planHash } from './sepolia-tournament.js';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';
import { captureTournamentSnapshot } from './sepolia-tournament-capture.js';
import { buildTournamentFinalScores,exportSeasonContext,verifySeasonCutoff } from './sepolia-tournament-final.js';
import { buildConvictionBonusByUser,buildPenalty,compareTournamentRows } from './points-tournament-leaderboard.js';
import { SEPOLIA_TOURNAMENT_SCHEMA,tournamentStore } from './sepolia-tournament-store.js';
import { tournamentCloseStore } from './sepolia-tournament-close-store.js';
import { assertTournamentTradingOpen,publicSeasonResult,readRuntimeSeason } from './sepolia-tournament-season.js';
import { closeCommand } from '../scripts/onchain-sepolia-close.mjs';
import { JOIN_ABI } from './sepolia-tournament-join.js';
import { createTournamentResultsHandler } from '../points/tournament-results.js';

function closingFixture({resolved=true,...options}={}) {
  const f=fixture({resolved,planOptions:{startsAt:'2020-11-01T06:00:00Z',endsAt:'2020-12-01T06:00:00Z',...options}});
  const plan=f.input.cycle.plan,start=Date.parse(plan.startsAt)/1000,end=Date.parse(plan.endsAt)/1000;
  f.block=n=>({number:n,hash:hash(n),timestamp:n>=200?end-1+(n-200):start+n-100});
  f.options.provider.getBlock=async n=>f.block(n);
  f.options.provider.getBlockNumber=async()=>202;
  f.input.final=true;
  const context={version:1,cycleId:plan.cycleId,planHash:planHash(plan),scoringStartsAt:plan.startsAt,operationCloseAt:plan.endsAt,
    users:[{username:'alice',createdAt:'2020-10-01T00:00:00Z'}],
    markets:[{pool:addr(40),pointsMarketId:10,exposureGroupId:10,touchMarket:false},
      {pool:addr(41),pointsMarketId:11,exposureGroupId:11,touchMarket:false}]};
  f.context=context;
  f.build=async()=>{
    const artifact=await buildTournamentSnapshot(f.input,f.options);
    const args={artifact,reviewedSnapshotHash:artifact.snapshotHash,context:f.context,reviewedContextHash:planHash(f.context),now:'2021-01-01T00:00:00Z'};
    return {artifact,args,result:buildTournamentFinalScores(args)};
  };
  return f;
}
const envFor = plan => ({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',
  ONCHAIN_CHAIN_ID:'421614',ONCHAIN_TOURNAMENT_SEASON_ENABLED:'true',ONCHAIN_TOURNAMENT_CYCLE_ID:plan.cycleId,
  ONCHAIN_RPC_URL:'https://rpc.invalid',DATABASE_URL:'postgres://local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_COLLATERAL_ADDRESS:plan.deployment.token,ONCHAIN_MARKET_FACTORY_ADDRESS:plan.deployment.factoryV1,
  ONCHAIN_MARKET_FACTORY_V2_ADDRESS:plan.deployment.factoryV2,ONCHAIN_TRADING_ROUTER_ADDRESS:plan.deployment.router});

test('final scores reuse Points conviction, inactivity and qualification rules with no chain writes',async()=>{
  const f=closingFixture(),{artifact,result}=await f.build(),row=result.rows[0];
  assert.equal(artifact.version,3);assert.equal(result.mode,'final');assert.equal(result.status,'closed');
  assert.equal(result.readyForRewards,false);assert.equal(row.marketPnl,145);assert.equal(row.qualifyingMarkets,1);assert.equal(row.qualified,false);
  const expected=buildConvictionBonusByUser([{username:'alice',market_id:10,outcome_index:0,side:'buy',shares:180,
    collateral:100,tournament_featured:true,created_at:artifact.snapshot.events[0].timestamp,
    market_status:'resolved',market_outcome:0,market_start_time:f.input.cycle.plan.startsAt,market_end_time:artifact.snapshot.markets[0].endsAt},
    {username:'alice',market_id:10,outcome_index:0,side:'sell',shares:90,collateral:45,tournament_featured:true,
      created_at:new Date(f.block(120).timestamp*1000).toISOString()}],new Map([['alice:10',35]]));
  assert.equal(row.convictionBonus,Math.round(expected.bonusByUser.get('alice')*100)/100);
  const penalty=buildPenalty({user:{created_at:'2020-10-01'},activity:{active_day_keys:['2020-11-01']},now:new Date(result.window.rankingCutoffAt),
    window:{...result.window,operationCloseAt:new Date(Date.parse(result.window.operationCloseAt)-1).toISOString()}});
  assert.equal(row.inactiveDays,29); // No extra December penalty for a November-only season.
  assert.equal(row.inactivityPenalty,penalty.inactivityPenalty);assert.equal(row.score,Math.round((145+row.convictionBonus-penalty.inactivityPenalty)*100)/100);
  assert.equal(row.liquidityReward,0);assert.equal(row.parlayPnl,0);assert.equal(row.stockPnl,0);
  assert.deepEqual(result.rules.unsupported,['liquidityReward','parlayPnl','stockPnl','walletRewards']);
  assert.equal(result.rules.prizes,undefined);assert.equal(result.rules.rewards,undefined);
});

test('season cutoff must bracket the exact exclusive end with confirmed adjacent canonical blocks',async()=>{
  const f=closingFixture();
  for (const change of [()=>f.input.asOfBlock=199,()=>f.input.asOfBlock=201,
    ()=>f.options.provider.getBlockNumber=async()=>201]) {
    const g=closingFixture(); // Keep the mutation scoped to the current fixture.
    change();await assert.rejects(buildTournamentSnapshot(f.input,f.options),/boundary|confirmations/);
    Object.assign(f,g);
  }
  const {result}=await closingFixture().build();await verifySeasonCutoff(result,closingFixture().options.provider);
  await assert.rejects(verifySeasonCutoff(result,{...closingFixture().options.provider,getBlock:async n=>({...closingFixture().block(n),hash:hash(999)})}),/reorg/);
});

test('final ranking values unresolved positions at cutoff and is independent of later settlement',async()=>{
  const f=closingFixture({resolved:false}),{artifact,result}=await f.build();
  assert.equal(result.rows[0].marketPnl,-13.33);assert.ok(result.rows[0].currentPositionValue>0);
  const before=structuredClone(result);
  f.contracts.get(addr(40)).state.outcome=2;
  assert.deepEqual(buildTournamentFinalScores({artifact,context:f.context,reviewedSnapshotHash:artifact.snapshotHash,
    reviewedContextHash:planHash(f.context),now:'2030-01-01'}),before);
});

test('redeeming before cutoff or leaving winnings unclaimed gives the same PnL and conviction',async()=>{
  const claimed=closingFixture(),unclaimed=closingFixture();
  for (const tx of [hash(631),hash(632)]) {
    const receipt=unclaimed.receipts.get(tx);
    unclaimed.logs.splice(0,unclaimed.logs.length,...unclaimed.logs.filter(l=>l.transactionHash!==tx));unclaimed.receipts.delete(tx);
    assert.ok(receipt);
  }
  const a=(await claimed.build()).result.rows[0],b=(await unclaimed.build()).result.rows[0];
  assert.equal(a.marketPnl,b.marketPnl);assert.equal(a.convictionBonus,b.convictionBonus);assert.equal(a.score,b.score);
  assert.equal(a.currentPositionValue,0);assert.equal(b.currentPositionValue,260);
});

test('touch exclusions and grouped exposure use the existing Points conviction and qualification rules',async()=>{
  const f=closingFixture();f.context.markets[0].touchMarket=true;
  assert.equal((await f.build()).result.rows[0].convictionBonus,0);
  f.context.markets[0].touchMarket=false;
  const second=f.receipts.get(hash(602)).logs;
  Object.assign(second[0],f.cashLog(addr(30),addr(41),'100000000',3));
  Object.assign(second[2],f.encoded(f.eventAbis[2],'SharesBought',[addr(30),2,'100000000','1000000','170000000'],addr(41),5));
  f.contracts.get(addr(41)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===2?100000000:0;
  assert.equal((await f.build()).result.rows[0].qualifyingMarkets,2);
  f.context.markets[1].exposureGroupId=10;
  const row=(await f.build()).result.rows[0];assert.equal(row.qualifyingMarkets,1);assert.ok(row.convictionBonus>0);
});

test('final adapter refuses amounts beyond Points exact integer-unit range',async()=>{
  await assert.rejects(closingFixture({allocation:'9007199255',maxTotalMxnp:'10000000000'}).build(),/points_scoring_range_exceeded/);
});

test('outside-funded buys cannot create qualifying activity or conviction; outgoing shares remove lots',async()=>{
  const f=closingFixture({resolved:false});
  f.addReceipt(hash(800),105,[f.cashLog(addr(91),addr(30),'500000000')]);
  const {result}=await f.build();assert.equal(result.rows[0].qualifyingMarkets,0);assert.equal(result.rows[0].convictionBonus,0);
  const g=closingFixture({resolved:false});
  g.addReceipt(hash(801),125,[g.shareLog(1,addr(30),addr(99),0,'90000000')]);
  const artifact=await buildTournamentSnapshot(g.input,g.options);
  assert.equal(artifact.scores.eligibleRemovals[0].sharesUnits,'90000000');
  assert.equal(buildTournamentFinalScores({artifact,reviewedSnapshotHash:artifact.snapshotHash,context:g.context,
    reviewedContextHash:planHash(g.context),now:'2021-01-01'}).rows[0].convictionBonus,0);
});

test('late joiners are scored only after the canonical grant and owe no earlier inactivity penalty',async()=>{
  const f=closingFixture({resolved:false,lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'}),p=f.input.cycle.plan;
  const abi=new ethers.utils.Interface(JOIN_ABI),grant={planHash:planHash(p),username:'bob',wallet:addr(31),suborg:'bob',txHash:hash(750)};
  const original=f.block;f.block=n=>n>=180&&n<200?{...original(n),timestamp:Date.parse(p.startsAt)/1000+20*86400+n-180}:original(n);
  f.input.lateJoins=[grant];f.context.users.push({username:'bob',createdAt:'2020-10-01T00:00:00Z'});
  f.addReceipt(grant.txHash,190,[f.cashLog(p.deployment.operations,grant.wallet,p.allocationUnits)]);
  f.transactions.set(grant.txHash,{hash:grant.txHash,blockNumber:190,blockHash:hash(190),chainId:421614,from:p.deployment.operations,
    to:p.deployment.token,value:0,data:abi.encodeFunctionData('transfer',[grant.wallet,p.allocationUnits])});
  f.addReceipt(hash(751),195,[f.cashLog(grant.wallet,addr(40),'100000000'),f.shareLog(1,addr(40),grant.wallet,0,'180000000',1),
    f.encoded(f.eventAbis[1],'SharesBought',[grant.wallet,true,'100000000','1000000','180000000'],addr(40),2)]);
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>Number(index)===0?(wallet.toLowerCase()===grant.wallet?100000000:50000000):0;
  const {artifact,result}=await f.build(),bob=result.rows.find(r=>r.username==='bob'),alice=result.rows.find(r=>r.username==='alice');
  const expected=buildPenalty({user:{created_at:artifact.snapshot.lateRegistrations[0].timestamp},
    activity:{active_day_keys:['2020-11-21']},now:new Date(p.endsAt),
    window:{...result.window,operationCloseAt:new Date(Date.parse(p.endsAt)-1).toISOString()}});
  assert.equal(bob.inactivityPenalty,expected.inactivityPenalty);assert.ok(bob.inactiveDays<alice.inactiveDays);
  assert.equal(bob.qualifyingMarkets,1);assert.equal(bob.buyCount,1);assert.equal(p.userCount,1);
  assert.equal(artifact.lateJoinReferences.length,1);assert.equal(result.totalParticipants,2);
});

test('final scoring preserves cancellation refunds and uses the corrected winner at cutoff',async()=>{
  const f=closingFixture({resolved:false}),pool=addr(40);
  f.contracts.get(pool).state.canceled=true;
  f.addReceipt(hash(770),130,[f.encoded(f.eventAbis[1],'MarketCanceled',[0],pool)]);
  const before=(await f.build()).result.rows[0];
  f.addReceipt(hash(771),140,[f.shareLog(1,addr(30),ethers.constants.AddressZero,0,'90000000',0),
    f.cashLog(pool,addr(30),'50000000',1),f.encoded(f.eventAbis[1],'CancelRefunded',[addr(30),'50000000'],pool,2)]);
  f.contracts.get(pool).state.costBasis=()=>0;
  const after=(await f.build()).result.rows[0];
  assert.equal(after.marketPnl,before.marketPnl);assert.equal(after.convictionBonus,0);assert.equal(after.totalActions,before.totalActions);
  const g=closingFixture({resolved:false}),abi=g.eventAbis[1];g.contracts.get(pool).state.resolved=true;g.contracts.get(pool).state.outcome=2;
  g.addReceipt(hash(780),130,[g.encoded(abi,'MarketResolved',[0,1],pool)]);
  g.addReceipt(hash(781),140,[g.encoded(abi,'ResolutionDisputeOpened',[0,1],pool)]);
  g.addReceipt(hash(782),150,[g.encoded(abi,'MarketResolutionCorrected',[0,1,2],pool,0),g.encoded(abi,'MarketResolved',[0,2],pool,1)]);
  const corrected=await g.build();assert.equal(corrected.artifact.snapshot.markets[0].winner,1);
  assert.equal(corrected.result.rows[0].convictionBonus,0);
});

test('unreviewed/incomplete/tampered captures or Points metadata cannot close a season',async()=>{
  const {args}=await closingFixture().build();
  for (const change of [a=>a.now='2020-11-30',a=>a.reviewedSnapshotHash='0'.repeat(64),
    a=>a.reviewedContextHash='0'.repeat(64),a=>a.context.users=[],a=>a.context.markets.pop(),
    a=>a.context.users[0].createdAt='2020-12-02',a=>a.artifact.scores.rows[0].pnlUnits='999999',
    a=>a.artifact.cutoffBoundary.nextBlock.blockNumber=250,a=>a.context.operationCloseAt='2020-11-30']) {
    const a=structuredClone(args);change(a);assert.throws(()=>buildTournamentFinalScores(a));
  }
  const a=structuredClone(args);a.artifact.scores.transferReconciliation.historicalBalancesVerified=false;
  const {snapshotHash,...body}=a.artifact;a.artifact.snapshotHash=planHash(body);a.reviewedSnapshotHash=a.artifact.snapshotHash;
  assert.throws(()=>buildTournamentFinalScores(a),/verified_transfer/);
});

test('Points tie breaking remains score, inactive days, qualifying markets, account age, username',()=>{
  const rows=[['a',1,0,2,'2020-01-01'],['b',1,0,2,'2019-01-01'],['c',1,0,3,'2020-01-01'],['d',1,1,3,'2020-01-01'],['e',2,1,0,'2020-01-01']]
    .map(([username,score,inactiveDays,qualifyingMarkets,createdAt])=>({username,score,inactiveDays,qualifyingMarkets,createdAt}));
  assert.deepEqual(rows.sort(compareTournamentRows).map(r=>r.username),['e','c','b','a','d']);
});

test('resumable final capture preserves the boundary and cannot reuse a mid-season checkpoint',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pronos-final-capture-'));
  try {
    const f=closingFixture(),options={...f.options,checkpointDirectory:dir,maxRequests:5000};
    const result=await captureTournamentSnapshot(f.input,options);assert.equal(result.status,'complete');assert.equal(result.artifact.version,3);
    assert.deepEqual((await captureTournamentSnapshot(f.input,options)).artifact,result.artifact);
    await assert.rejects(captureTournamentSnapshot({...f.input,final:false},options),/context_mismatch/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('context export reads only Points metadata, handles both SQL result shapes and checks complete mappings',async()=>{
  const f=closingFixture(),{artifact}=await f.build();
  const sql=async(strings)=>{
    const q=strings.join('?');assert.match(q,/^SELECT /);assert.doesNotMatch(q,/signed_tx|balance|UPDATE|INSERT/);
    return q.includes('points_users')?{rows:[{username:'alice',created_at:'2020-10-01'}]}:
      f.context.markets.map(m=>({pool:m.pool,points_market_id:m.pointsMarketId,exposure_group_id:m.exposureGroupId,resolver_config:{kind:'touch'}}));
  };
  const context=await exportSeasonContext(artifact,sql);assert.ok(context.markets.every(m=>m.touchMarket));
  await assert.rejects(exportSeasonContext(artifact,async()=>[]),/incomplete/);
});

test('local PostgreSQL freezes results once, preserves Points/current token and refuses changed/pending closes',async()=>{
  const f=closingFixture(),{result}=await f.build(),db=new PGlite();
  const sql=async(strings,...values)=>(await db.query(strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,''),values)).rows;
  try {
    for (const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
    for (const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
    await db.exec("CREATE TABLE points_cycles(id integer,status text); INSERT INTO points_cycles VALUES(5,'active'); CREATE TABLE points_balances(username text,balance numeric); INSERT INTO points_balances VALUES('alice',500)");
    await tournamentStore(sql).register(f.input.cycle.plan,f.input.reviewedPlanHash);
    const store=tournamentCloseStore(sql);
    await assert.rejects(store.close(result),/not_funded/);
    await db.exec("UPDATE sepolia_tournament_cycles SET status='funded'");
    const operations=f.input.cycle.plan.deployment.operations,lease='00000000-0000-0000-0000-000000000001';
    assert.equal(await tournamentStore(sql).acquire(operations,lease),true);
    await assert.rejects(store.close(result),/funder_busy/);await tournamentStore(sql).release(operations,lease);
    await db.query(`INSERT INTO sepolia_tournament_joins
      (tx_hash,cycle_id,plan_hash,username,wallet_address,suborg_id,funder_address,nonce,amount_units,signed_tx,status)
      VALUES ($1,$2,$3,'bob',$4,'bob',$5,0,500000000,'private-test-bytes','prepared')`,
      [hash(750),result.cycleId,result.planHash,addr(31),operations]);
    await assert.rejects(store.close(result),/joins_pending/);
    await db.exec("UPDATE sepolia_tournament_joins SET status='confirmed'");
    await assert.rejects(store.close(result),/capture_incomplete/);
    await db.exec("UPDATE sepolia_tournament_joins SET status='reverted'");
    assert.deepEqual(await store.close(result),result);assert.deepEqual(await store.close(result),result);
    const other={...result,label:'tamper'};delete other.resultHash;other.resultHash=planHash(other);
    await assert.rejects(store.close(other),/immutable/);
    await assert.rejects(db.exec('DELETE FROM sepolia_tournament_closures'),/immutable/);
    await assert.rejects(db.exec("UPDATE sepolia_tournament_closures SET result_hash=repeat('0',64)"),/immutable/);
    assert.deepEqual((await db.query('SELECT * FROM points_cycles')).rows,[{id:5,status:'active'}]);
    assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance,'500');
    assert.equal((await db.query('SELECT token_address,status FROM sepolia_tournament_cycles')).rows[0].token_address,result.token);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM sepolia_tournament_mints')).rows[0].n,0);
    const env=envFor(f.input.cycle.plan),season=await readRuntimeSeason({env,sqlFor:()=>sql});assert.deepEqual(season.closure,result);
    await assert.rejects(assertTournamentTradingOpen({env,sqlFor:()=>sql,now:'2020-11-15'}),/tournament_closed/);
    // Public output contains the expected Points fields, never roster keys or addresses.
    const payload=publicSeasonResult(result,'ALICE');assert.equal(payload.me.username,'alice');assert.equal(payload.top.length,1);
    assert.doesNotMatch(JSON.stringify(payload),/0x[0-9a-f]{40}|suborg|createdAt|plan_hash/);
  } finally {await db.close();}
});

test('frozen results API is read-only, private, disabled in Pointbreak and sanitizes failures',async()=>{
  const f=closingFixture(),{result}=await f.build(),env=envFor(f.input.cycle.plan);
  const run=async(options={},method='GET')=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;},end(){return this;}};
    await createTournamentResultsHandler({env,readSeason:async()=>({closure:result}),sessionFor:()=>({username:'alice'}),...options})({method,headers:{}},res);
    return res;
  };
  const ok=await run();assert.equal(ok.code,200);assert.equal(ok.headers['Cache-Control'],'private, no-store');assert.equal(ok.body.me.username,'alice');
  assert.doesNotMatch(JSON.stringify(ok.body),/0x[0-9a-f]{40}|suborg|createdAt/);
  const guest=await run({sessionFor:()=>null});assert.equal(guest.body.me,null);
  assert.equal((await run({env:{...env,VERCEL_GIT_COMMIT_REF:'pointbreak'},readSeason:()=>assert.fail('must not connect')})).code,404);
  assert.equal((await run({readSeason:async()=>({closure:null})})).code,409);
  assert.deepEqual((await run({readSeason:()=>{throw Error('private database details');}})).body,{error:'tournament_results_unavailable'});
  assert.equal((await run({},'POST')).code,405);
});

test('season gate is off without the explicit future flag and fails closed for wrong runtimes',async()=>{
  const f=closingFixture(),env=envFor(f.input.cycle.plan);
  for (const change of [{ONCHAIN_TOURNAMENT_SEASON_ENABLED:'false'},{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'}]) {
    await assertTournamentTradingOpen({env:{...env,...change},sqlFor:()=>assert.fail('disabled must not connect')});
  }
  await assert.rejects(assertTournamentTradingOpen({env:{...env,DATABASE_URL:'postgres://production/db'}}),/unavailable/);
  const sqlFor=()=>async strings=>strings.join('').includes('FROM sepolia_tournament_cycles')?[f.input.cycle]:[];
  await assert.rejects(assertTournamentTradingOpen({env,sqlFor,now:'2020-10-01'}),/not_started/);
  await assertTournamentTradingOpen({env,sqlFor,now:'2020-11-15'});
  await assert.rejects(assertTournamentTradingOpen({env,sqlFor,now:f.input.cycle.plan.endsAt}),/tournament_closed/);
  await assert.rejects(assertTournamentTradingOpen({env:{...env,ONCHAIN_COLLATERAL_ADDRESS:addr(99)},sqlFor}),/unavailable/);
});

test('offline close CLI needs no DB/RPC/signers, writes a private exclusive export and rejects Pointbreak apply',async()=>{
  const f=closingFixture(),{artifact}=await f.build(),dir=await mkdtemp(join(tmpdir(),'pronos-close-'));
  try {
    const input=join(dir,'capture.json'),context=join(dir,'context.json'),output=join(dir,'result.json');
    await writeFile(input,JSON.stringify(artifact));await writeFile(context,JSON.stringify(f.context));
    const values={input,context,output,'reviewed-snapshot-hash':artifact.snapshotHash,'reviewed-context-hash':planHash(f.context)};
    const deps={sqlFor:()=>assert.fail('offline must not connect'),providerFor:()=>assert.fail('offline must not connect')};
    assert.equal((await closeCommand(values,deps)).applied,false);
    assert.equal((await stat(output)).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(output,'utf8')).status,'closed');
    await assert.rejects(closeCommand(values,deps),/EEXIST/);
    await assert.rejects(closeCommand({...values,apply:true},{...deps,branch:()=> 'pointbreak',env:envFor(f.input.cycle.plan)}),/destination/);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('explicit preview close CLI verifies live hashes and persists once without a signer or chain writes',async()=>{
  const f=closingFixture(),{artifact,result}=await f.build(),db=new PGlite(),dir=await mkdtemp(join(tmpdir(),'pronos-close-apply-'));
  const sql=async(strings,...values)=>(await db.query(strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,''),values)).rows;
  try {
    for (const ddl of SEPOLIA_TOURNAMENT_SCHEMA) await db.exec(ddl);
    await tournamentStore(sql).register(f.input.cycle.plan,result.planHash);await db.exec("UPDATE sepolia_tournament_cycles SET status='funded'");
    const input=join(dir,'capture.json'),context=join(dir,'context.json');
    await writeFile(input,JSON.stringify(artifact));await writeFile(context,JSON.stringify(f.context));
    const env=envFor(f.input.cycle.plan),args={input,context,output:join(dir,'result.json'),apply:true,
      'reviewed-snapshot-hash':artifact.snapshotHash,'reviewed-context-hash':planHash(f.context),
      'expected-host':new URL(env.DATABASE_URL).hostname};
    const dependencies={env,sqlFor:()=>sql,branch:()=> 'onchain-sepolia',providerFor:()=>({
      getNetwork:f.options.provider.getNetwork,getBlockNumber:f.options.provider.getBlockNumber,getBlock:f.options.provider.getBlock,
    })};
    assert.equal((await closeCommand(args,dependencies)).applied,true);
    assert.deepEqual(await tournamentCloseStore(sql).read(result.cycleId),result);
    await closeCommand({...args,output:join(dir,'retry.json')},dependencies);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sepolia_tournament_closures')).rows[0].n,1);
  } finally {await db.close();await rm(dir,{recursive:true,force:true});}
});
