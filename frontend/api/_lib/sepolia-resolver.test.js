import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {RESOLVER_MIGRATION,runSepoliaResolver,automaticResolutionSupported,previewSepoliaResolutions,inspectResolutionCandidate,reviewSepoliaResolution} from './sepolia-resolver.js';
import {loadSettlementMarket,settlementSourceHash} from './onchain-admin-settlement.js';
import {preview} from './test-support/sepolia-settlement.mjs';
const env={...preview,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'true',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)};
const addr=n=>`0x${String(n).repeat(40)}`;
async function fixture(t){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE ROLE pronos_reader;CREATE ROLE pronos_writer;CREATE ROLE sepolia_indexer;CREATE ROLE sepolia_standings;
    CREATE TABLE sepolia_trade_requests(request_key text,chain_id int,wallet_address text,suborg_id text,action text,payload jsonb,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE points_markets(id int,chain_id int,mode text,chain_address text,chain_market_id text,parent_id int,amm_mode text,question text,
      resolver_type text,resolver_config jsonb,outcomes jsonb,start_time timestamptz,end_time timestamptz,sport text,league text,status text);
    CREATE TABLE protocol_markets(id int,chain_id int,status text,pool_address text,market_id int,factory_address text,question text,start_time timestamptz,end_time timestamptz,resolver_type text,resolver_config jsonb,outcomes jsonb,outcome_count int,protocol_version text,sport text,league text,outcome int,tx_hash text);
    CREATE TABLE points_pending_markets(id int,approved_market_id int,source_data jsonb);`);
  for(const ddl of RESOLVER_MIGRATION)await db.exec(ddl);
  const sql=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),v)).rows;
  const calls=[],decisions=[];
  const settle=async args=>{calls.push(args);return {httpStatus:200,body:{txHash:'0xtest'}};};
  const decide=async m=>{decisions.push(m);return {winningIdx:0,finalScore:'2-1',resolverInfo:{source:'fixture'}};};
  return {db,sql,calls,decisions,async seed(id,{mode='onchain',chain=421614,factory=addr(1),type='sports_api',cfg={source:'espn',shape:'binary'},end="now()-interval '1 hour'"}={}){
    await db.query(`INSERT INTO protocol_markets VALUES($1,$2,'active',$3,$1,$4,'Fixture',null,${end},$5,$6,'["Yes","No"]',2,'v1',null,null,null,null)`,[id,chain,addr(4),factory,type,JSON.stringify(cfg)]);
    await db.query(`INSERT INTO points_markets VALUES($1,$2,$3,$4,($1::int)::text,null,'unified','Fixture',
      $5,$6,'["Published A","Published B"]',null,${end},null,null,'active')`,[id,chain,mode,addr(4),type,JSON.stringify(cfg)]);
  },run:extra=>runSepoliaResolver({sql,provider:{getNetwork:async()=>({chainId:421614})},env,decide,settle,...extra})};
}
test('automatic source allowlist leaves parallel and review-heavy markets manual',()=>{
  assert.equal(automaticResolutionSupported({resolver_type:'sports_api',resolver_config:{source:'espn',shape:'binary'}}),true);
  for(const m of [{resolver_type:'mananera'},{resolver_type:'sports_api',resolver_config:{source:'espn',shape:'parallel'}},{resolver_type:'sports_api',parent_id:2},{resolver_type:'sports_api',resolver_config:{source:'unknown',shape:'binary'}}])assert.equal(automaticResolutionSupported(m),false);
});
test('scheduled resolver filters chain/factory/mode/time and saves deterministic source-reviewed intents',async t=>{
  const f=await fixture(t);await f.seed(1);await f.seed(2,{mode:'points'});await f.seed(3,{chain:42161});await f.seed(4,{factory:addr(8)});await f.seed(5,{end:"now()+interval '1 hour'"});
  await f.seed(6);
  await f.db.exec("UPDATE points_markets SET end_time=now()+interval '1 hour' WHERE id=6");
  const first=await f.run(),second=await f.run();assert.equal(first.resolved.length,1);assert.equal(f.decisions.length,2);
  assert.equal(f.calls[0].input.marketId,1);assert.equal(f.calls[0].key,f.calls[1].key);assert.equal(f.calls[0].origin,'scheduler');
  assert.match(f.calls[0].expectedSourceHash,/^[a-f0-9]{64}$/);assert.equal(f.calls[0].evidence.finalScore,'2-1');
  const runs=(await f.db.query('SELECT status,report FROM sepolia_resolver_runs')).rows;assert.equal(runs.length,2);assert.equal(runs[0].status,'ok');
});
test('pending signed requests resume before new evidence; no new intent until reconciliation',async t=>{
  const f=await fixture(t);await f.seed(1);
  const input={marketId:91,action:'resolve',outcome:1,reason:'Scheduled verified source resolution',reviewHash:'b'.repeat(64),origin:'scheduler'};
  await f.db.query(`INSERT INTO sepolia_trade_requests VALUES('auto_original',421614,$1,'ops','admin_resolve',$2,'pending',now())`,[env.ONCHAIN_RESOLVER_ADDRESS.toLowerCase(),JSON.stringify(input)]);
  const r=await f.run({settle:async args=>{f.calls.push(args);return {httpStatus:202,body:{txHash:'0xpending'}};}});
  assert.equal(r.pending.length,1);assert.equal(f.decisions.length,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].key,'auto_original');assert.equal(f.calls[0].input.marketId,91);
  assert.equal(f.calls[0].input.reviewHash,input.reviewHash);
});
test('leases serialize invocations and disabled/wrong-chain calls cannot create requests',async t=>{
  const f=await fixture(t);
  await f.db.exec("INSERT INTO sepolia_resolver_lease VALUES('preview','11111111-1111-1111-1111-111111111111',now()+interval '1 hour')");
  assert.equal((await f.run()).reason,'already_running');assert.equal(f.calls.length,0);
  assert.equal((await f.run({env:{...env,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'false'},sql:()=>{throw Error('SQL forbidden');}})).status,'disabled');
  await assert.rejects(f.run({provider:{getNetwork:async()=>({chainId:42161})}}),/resolver_wrong_chain/);
});
test('evidence errors defer, while settlement attempts are capped even when all throw',async t=>{
  const f=await fixture(t);for(let i=1;i<=6;i++)await f.seed(i);
  const deferred=await f.run({decide:async()=>{throw Object.assign(Error('incomplete transcript'),{benign:true});}});
  assert.equal(deferred.deferred.length,6);assert.equal(f.calls.length,0);
  const failed=await f.run({settle:async a=>{f.calls.push(a);throw Error('private RPC credentials');}});
  assert.equal(f.calls.length,3);assert.equal(failed.deferred.length,3);assert.doesNotMatch(JSON.stringify(failed),/private RPC/);
});

test('read-only source inspection works with scheduling off and cannot create runs, leases or requests',async t=>{
  const f=await fixture(t);await f.seed(1);await f.seed(2,{type:'mananera'});await f.seed(3);
  const queries=[],sql=async(parts,...values)=>{const query=parts.join('');queries.push(query);assert.match(query,/^\s*SELECT/);return f.sql(parts,...values);};
  const result=await previewSepoliaResolutions({sql,env:{...env,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'false'},provider:{getNetwork:async()=>({chainId:421614})},
    decide:async m=>{if(m.id===3)throw Object.assign(Error('not final'),{benign:true});return {winningIdx:0,finalScore:'2-1'};}});
  assert.equal(result.transactionsSubmitted,0);assert.equal(result.schedulingEnabled,false);
  assert.deepEqual(result.candidates.map(m=>m.status),['ready','manual','deferred']);
  assert.equal((await f.db.query('SELECT count(*) FROM sepolia_resolver_runs')).rows[0].count,0);
});

test('scheduler and Por resolver use the same published ESPN result when the V1 index has generic labels', async t => {
  const f = await fixture(t);
  const cfg = { source:'espn',shape:'binary',leaguePath:'basketball/nba',eventId:'401000001',
    homeName:'Atlanta Hawks',awayName:'Los Angeles Lakers' };
  await f.seed(16,{cfg});
  await f.db.exec(`UPDATE protocol_markets SET resolver_type=NULL,resolver_config=NULL WHERE id=16;
    UPDATE points_markets SET outcomes='["Atlanta Hawks","Los Angeles Lakers"]' WHERE id=16`);
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${cfg.eventId}`;
  let final = false;
  t.mock.method(globalThis, 'fetch', async request => {
    if (new URL(request).pathname.endsWith('/scoreboard')) return { ok:true,json:async()=>({events:[]}) };
    assert.equal(request,url);
    return { ok:true,json:async()=>({header:{id:cfg.eventId,competitions:[{
      status:{type:{state:final?'post':'in',completed:final,name:final?'STATUS_FINAL':'STATUS_IN_PROGRESS'}},
      competitors:[
        {homeAway:'away',score:'108',winner:true,team:{displayName:cfg.awayName}},
        {homeAway:'home',score:'102',winner:false,team:{displayName:cfg.homeName}},
      ],
    }]}}) };
  });
  const args = {sql:f.sql,env:{...env,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'false'},
    provider:{getNetwork:async()=>({chainId:421614})}};
  const inProgress = await previewSepoliaResolutions(args);
  assert.equal(inProgress.candidates[0].status,'deferred');
  assert.equal(inProgress.candidates[0].input,undefined);

  final = true;
  const scheduled = await previewSepoliaResolutions(args);
  const manual = await reviewSepoliaResolution({...args,marketId:16,payoutPreview:async()=>({payouts:[]})});
  const [decision] = scheduled.candidates;
  assert.equal(decision.status,'ready');
  assert.deepEqual(manual.outcomes,[cfg.homeName,cfg.awayName]);
  assert.equal(manual.suggestedOutcome,1);
  assert.equal(decision.input.outcome,manual.suggestedOutcome);
  assert.equal(decision.input.reviewHash,manual.reviewHash);
  assert.equal(decision.expectedSourceHash,settlementSourceHash(await loadSettlementMarket(f.sql,16,env)));
  assert.equal(manual.evidence.url,url);
  assert.equal(decision.evidence.finalScore,manual.evidence.score);
  assert.match(manual.evidence.score,/102-108/);
  assert.equal(scheduled.schedulingEnabled,false);
  assert.equal(scheduled.transactionsSubmitted,0);
  assert.equal(f.calls.length,0);
  assert.equal((await f.db.query('SELECT count(*) FROM sepolia_trade_requests')).rows[0].count,0);
});
test('unavailable evidence cannot starve later markets across bounded scheduled runs',async t=>{
  const f=await fixture(t);for(let i=1;i<=27;i++)await f.seed(i,{end:"'2026-01-01T00:00:00Z'::timestamptz"});
  const decide=async m=>{if(m.id<=25)throw Object.assign(Error('not final'),{benign:true});return {winningIdx:0};};
  const first=await f.run({decide}),second=await f.run({decide});assert.equal(first.checked,25);assert.equal(first.resolved.length,0);
  assert.equal(second.checked,2);assert.deepEqual(f.calls.map(c=>c.input.marketId),[26,27]);
});
test('inspection handles source timeout and invalid outcomes without signing or exposing provider errors',async()=>{
  const m={points_id:1,id:1,outcome_count:2,resolver_type:'sports_api',resolver_config:{source:'espn',shape:'binary'}};
  for(const decide of [async()=>({winningIdx:2}),async()=>{throw Error('private credentials');},()=>new Promise(()=>{})]) {
    const result=await inspectResolutionCandidate(m,{decide,timeoutMs:5});assert.equal(result.status,'deferred');assert.doesNotMatch(JSON.stringify(result),/private/);
  }
});

test('queue review checks only the chosen closed market, exposes official evidence and rejects wrong chain/mapping', async t => {
  const f = await fixture(t);
  for (let i = 1; i < 28; i++) await f.seed(i);
  await f.seed(28,{cfg:{source:'espn',shape:'binary',leaguePath:'football/college-football',eventId:'401866475'}});
  await f.db.exec('UPDATE protocol_markets SET resolver_type=NULL,resolver_config=NULL WHERE id=28');
  await f.seed(29,{end:"now()+interval '1 hour'"});
  const read = marketId => reviewSepoliaResolution({
    marketId, env, provider: {getNetwork:async()=>({chainId:421614})},
    sql: (parts,...values) => { assert.match(parts.join(''), /^\s*SELECT/); return f.sql(parts,...values); },
    decide: async market => {
      assert.equal(market.points_id,28);
      assert.equal(market.resolver_type,'sports_api');
      assert.deepEqual(market.outcomes,['Published A','Published B']);
      return {winningIdx:1,finalScore:'3–1',resolverInfo:{privateUrl:'secret token'}};
    },
    payoutPreview: async ({market}) => {
      assert.equal(market.points_id,28);
      return {blockNumber:100,payouts:[{outcome:1,payoutUnits:'12000000',shortfallUnits:'0'}]};
    },
  });
  const review = await read(28);
  assert.equal(review.suggestedOutcome,1);
  assert.equal(review.evidence.score,'3–1');
  assert.match(review.evidence.url,/espn\.com\/.*event=401866475$/);
  assert.match(review.reviewHash,/^[a-f0-9]{64}$/);
  assert.equal(review.estimate.payouts[0].payoutUnits,'12000000');
  assert.doesNotMatch(JSON.stringify(review),/secret token/);
  await assert.rejects(read(29),/settlement_market_state_changed/);
  await f.db.exec("UPDATE points_markets SET chain_id=42161 WHERE id=28");
  await assert.rejects(read(28),/settlement_market_mapping_unavailable/);
});
