import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { buildTournamentPlan,planHash } from './sepolia-tournament.js';
import { SEPOLIA_TOURNAMENT_SCHEMA,tournamentStore } from './sepolia-tournament-store.js';
import { readRuntimeSeason,publicSeasonResult } from './sepolia-tournament-season.js';
import { readArchivedSeason,readSeasonHistory,publicSeasonSummary } from './sepolia-tournament-presentation.js';
import { createTournamentResultsHandler } from '../points/tournament-results.js';
import { addr,hash } from './sepolia-tournament-test-fixture.js';

const deployment=n=>({chainId:421614,token:addr(n+1),factoryV1:addr(n+2),factoryV2:addr(n+3),shareV1:addr(n+4),shareV2:addr(n+5),
  router:addr(n+6),owner:addr(90),operations:addr(91),routerCodeHash:hash(n+1)});
const planFor=(id,n=0)=>buildTournamentPlan({cycleId:id,label:id,startsAt:'2020-11-01T06:00:00Z',endsAt:'2020-12-01T06:00:00Z',
  deployment:deployment(n),previousDeployment:deployment(n+100),users:[{username:'alice',wallet_address:addr(30),turnkey_sub_org_id:'alice'}],liquidityMxnp:'1000',maxTotalMxnp:'1500'});
const envFor=plan=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',
  ONCHAIN_CHAIN_ID:'421614',ONCHAIN_TOURNAMENT_SEASON_ENABLED:'true',ONCHAIN_TOURNAMENT_CYCLE_ID:plan.cycleId,
  DATABASE_URL:'postgres://local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_COLLATERAL_ADDRESS:plan.deployment.token,ONCHAIN_MARKET_FACTORY_ADDRESS:plan.deployment.factoryV1,
  ONCHAIN_MARKET_FACTORY_V2_ADDRESS:plan.deployment.factoryV2,ONCHAIN_TRADING_ROUTER_ADDRESS:plan.deployment.router});
function resultFor(plan){
  const body={status:'closed',readyForRewards:false,cycleId:plan.cycleId,label:plan.label,planHash:planHash(plan),chainId:421614,
    token:plan.deployment.token,window:{startsAt:plan.startsAt,rankingCutoffAt:plan.endsAt},rules:{minEntryMxnp:100,qualifyingMarkets:10,inactivityPenalty:50},
    totalParticipants:27,rows:Array.from({length:27},(_,i)=>({username:i===26?'alice':`player${i}`,rank:i+1,score:100-i,
      marketPnl:200-i,convictionBonus:50,inactivityPenalty:150,qualifyingMarkets:10,qualified:true,createdAt:'private',wallet:addr(30),suborg:'private',futureAudit:'private'}))};
  return {...body,resultHash:planHash(body)};
}
async function setup(){
  const db=new PGlite(),sql=async(strings,...values)=>(await db.query(strings.reduce((q,s,i)=>q+(i?`$${i}`:'')+s,''),values)).rows;
  for(const ddl of SEPOLIA_TOURNAMENT_SCHEMA)await db.exec(ddl);
  const old=planFor('old-season'),current=planFor('current-season',1000),result=resultFor(old);
  for(const p of [old,current])await tournamentStore(sql).register(p,planHash(p));
  await db.exec("UPDATE sepolia_tournament_cycles SET status='funded'");
  await sql`INSERT INTO sepolia_tournament_closures(cycle_id,plan_hash,result_hash,result) VALUES(${old.cycleId},${planHash(old)},${result.resultHash},${JSON.stringify(result)}::jsonb)`;
  return {db,sql,old,current,result,env:envFor(current)};
}

test('archives survive a different current token and only read their own immutable plan',async()=>{
  const f=await setup();
  try {
    const read=await readArchivedSeason({env:f.env,cycleId:f.old.cycleId,sqlFor:()=>f.sql});assert.deepEqual(read,f.result);
    const runtime=await readRuntimeSeason({env:f.env,sqlFor:()=>f.sql});assert.equal(runtime.cycle.plan.cycleId,f.current.cycleId);assert.equal(runtime.closure,null);
    assert.equal(await readArchivedSeason({env:f.env,cycleId:'missing',sqlFor:()=>f.sql}),null);
    await assert.rejects(readArchivedSeason({env:f.env,cycleId:"old-season' OR true",sqlFor:()=>assert.fail('invalid ID cannot query')}),/invalid_cycle_id/);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM sepolia_tournament_closures')).rows[0].n,1);
  } finally {await f.db.close();}
});

test('history selects public metadata only and keeps reward approval separate',async()=>{
  const f=await setup();
  try {
    const history=await readSeasonHistory({env:f.env,sqlFor:()=>f.sql});assert.equal(history.seasons.length,1);assert.equal(history.hasMore,false);
    assert.equal(history.seasons[0].cycleId,'old-season');assert.equal(history.seasons[0].totalParticipants,27);assert.equal(history.seasons[0].readyForRewards,false);
    assert.doesNotMatch(JSON.stringify(history),/0x[0-9a-f]{40}|suborg|createdAt|futureAudit/);
    const publicResult=publicSeasonResult(f.result,'ALICE');assert.equal(publicResult.top.length,20);assert.equal(publicResult.me.rank,27);
    assert.equal(publicSeasonResult(f.result,null).me,null);assert.equal(publicSeasonResult(f.result,'stranger').me,null);
    assert.doesNotMatch(JSON.stringify(publicResult),/0x[0-9a-f]{40}|suborg|createdAt|futureAudit|private/);
  } finally {await f.db.close();}
});

test('archive listing is bounded to 20 and signals older results without loading private rows',async()=>{
  const plan=planFor('current-season'),env=envFor(plan);
  const sqlFor=()=>async(strings)=>{
    const query=strings.join('');assert.match(query,/LIMIT 21/);assert.doesNotMatch(query,/SELECT\s+\*|r\.result\s*[,\n]/);
    return Array.from({length:21},(_,i)=>({cycle_id:`season-${i}`,label:`Season ${i}`,total_participants:'600',cutoff_at:plan.endsAt,result_hash:hash(i)}));
  };
  const h=await readSeasonHistory({env,sqlFor});assert.equal(h.seasons.length,20);assert.equal(h.hasMore,true);
});

test('archive and history gates do not connect for disabled/production/Pointbreak and reject wrong databases',async()=>{
  const plan=planFor('current-season'),env=envFor(plan),sqlFor=()=>assert.fail('must not connect');
  for(const change of [{ONCHAIN_TOURNAMENT_SEASON_ENABLED:'false'},{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'}]) {
    assert.equal(await readArchivedSeason({env:{...env,...change},sqlFor,cycleId:'old-season'}),null);
    assert.deepEqual(await readSeasonHistory({env:{...env,...change},sqlFor}),{seasons:[],hasMore:false});
  }
  await assert.rejects(readArchivedSeason({env:{...env,DATABASE_URL:'postgres://production/db'},sqlFor,cycleId:'old-season'}),/unavailable/);
});

test('modified archived results and mismatched cutoff/plan identity are rejected',async()=>{
  const plan=planFor('old-season'),env=envFor(plan);
  for(const mutate of [r=>r.rows[0].score++,r=>r.cycleId='different',r=>r.chainId=42161,
    r=>r.window.rankingCutoffAt='2030-01-01T00:00:00Z',r=>r.token=addr(999),r=>r.totalParticipants++]) {
    const result=resultFor(plan);mutate(result);
    if(result.rows[0].score===100){const {resultHash,...body}=result;result.resultHash=planHash(body);}
    await assert.rejects(readArchivedSeason({env,cycleId:plan.cycleId,sqlFor:()=>async()=>[{plan,plan_hash:planHash(plan),status:'funded',result}]}),/unavailable/);
  }
});

test('season summary distinguishes exclusive start/end and frozen final results',()=>{
  const plan=planFor('current-season'),season={cycle:{plan},closure:null};
  assert.equal(publicSeasonSummary(season,'2020-10-31').status,'scheduled');
  assert.equal(publicSeasonSummary(season,plan.startsAt).status,'active');
  assert.equal(publicSeasonSummary(season,plan.endsAt).status,'awaiting_close');
  assert.equal(publicSeasonSummary({...season,closure:resultFor(plan)},plan.endsAt).status,'closed');
  assert.equal(publicSeasonSummary(season,plan.startsAt).rules.qualifyingMarkets,10);
});

test('results HTTP route keeps overview/history, selected archive, guest and session responses separate',async()=>{
  const plan=planFor('current-season'),result=resultFor(planFor('old-season')),env=envFor(plan);
  const run=async(query={},changes={})=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(body){this.body=body;return this;},end(){return this;}};
    const readArchive=async({cycleId})=>cycleId===result.cycleId?result:null;
    await createTournamentResultsHandler({env,readSeason:async()=>({cycle:{plan},closure:null}),readHistory:async()=>({seasons:[],hasMore:false}),readArchive,
      sessionFor:()=>({username:'alice'}),now:()=>new Date(plan.startsAt),...changes})({method:'GET',query,headers:{}},res);
    return res;
  };
  const overview=await run({action:'overview'});assert.equal(overview.code,200);assert.equal(overview.body.current.status,'active');assert.equal(overview.headers['Cache-Control'],'private, no-store');
  assert.equal((await run({cycleId:result.cycleId})).body.me.rank,27);
  assert.equal((await run({cycleId:result.cycleId},{sessionFor:()=>null})).body.me,null);
  assert.equal((await run({cycleId:'missing'})).code,404);assert.equal((await run()).code,409);
  for(const query of [{action:'bad'},{cycleId:['old-season']},{cycleId:'bad/'},{action:'overview',cycleId:'old-season'}])assert.equal((await run(query)).code,400);
  const failed=await run({cycleId:result.cycleId},{readArchive:()=>{throw Error('private SQL');}});
  assert.equal(failed.code,503);assert.deepEqual(failed.body,{error:'tournament_results_unavailable'});
});
