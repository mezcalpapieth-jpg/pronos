import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {RESOLVER_MIGRATION,runSepoliaResolver,automaticResolutionSupported} from './sepolia-resolver.js';
import {preview} from './test-support/sepolia-settlement.mjs';
const env={...preview,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'true',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40)};
const addr=n=>`0x${String(n).repeat(40)}`;
async function fixture(t){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE ROLE pronos_reader;CREATE ROLE pronos_writer;CREATE ROLE sepolia_indexer;CREATE ROLE sepolia_standings;
    CREATE TABLE sepolia_trade_requests(request_key text,chain_id int,wallet_address text,suborg_id text,action text,payload jsonb,status text,created_at timestamptz DEFAULT now());
    CREATE TABLE points_markets(id int,chain_id int,mode text,chain_address text,chain_market_id text,parent_id int,amm_mode text);
    CREATE TABLE protocol_markets(id int,chain_id int,status text,pool_address text,market_id int,factory_address text,question text,start_time timestamptz,end_time timestamptz,resolver_type text,resolver_config jsonb,outcomes jsonb,outcome_count int,protocol_version text,sport text,league text);
    CREATE TABLE points_pending_markets(id int,approved_market_id int,source_data jsonb);`);
  for(const ddl of RESOLVER_MIGRATION)await db.exec(ddl);
  const sql=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),v)).rows;
  const calls=[],decisions=[];
  const settle=async args=>{calls.push(args);return {httpStatus:200,body:{txHash:'0xtest'}};};
  const decide=async m=>{decisions.push(m);return {winningIdx:0,finalScore:'2-1',resolverInfo:{source:'fixture'}};};
  return {db,sql,calls,decisions,async seed(id,{mode='onchain',chain=421614,factory=addr(1),type='sports_api',cfg={source:'espn',shape:'binary'},end="now()-interval '1 hour'"}={}){
    await db.query(`INSERT INTO protocol_markets VALUES($1,$2,'active',$3,$1,$4,'Fixture',null,${end},$5,$6,'["Yes","No"]',2,'v1',null,null)`,[id,chain,addr(4),factory,type,JSON.stringify(cfg)]);
    await db.query(`INSERT INTO points_markets VALUES($1,$2,$3,$4,($1::int)::text,null,'unified')`,[id,chain,mode,addr(4)]);
  },run:extra=>runSepoliaResolver({sql,provider:{getNetwork:async()=>({chainId:421614})},env,decide,settle,...extra})};
}
test('automatic source allowlist leaves parallel and review-heavy markets manual',()=>{
  assert.equal(automaticResolutionSupported({resolver_type:'sports_api',resolver_config:{source:'espn',shape:'binary'}}),true);
  for(const m of [{resolver_type:'mananera'},{resolver_type:'sports_api',resolver_config:{source:'espn',shape:'parallel'}},{resolver_type:'sports_api',parent_id:2},{resolver_type:'sports_api',resolver_config:{source:'unknown',shape:'binary'}}])assert.equal(automaticResolutionSupported(m),false);
});
test('scheduled resolver filters chain/factory/mode/time and saves deterministic source-reviewed intents',async t=>{
  const f=await fixture(t);await f.seed(1);await f.seed(2,{mode:'points'});await f.seed(3,{chain:42161});await f.seed(4,{factory:addr(8)});await f.seed(5,{end:"now()+interval '1 hour'"});
  const first=await f.run(),second=await f.run();assert.equal(first.resolved.length,1);assert.equal(f.decisions.length,2);
  assert.equal(f.calls[0].input.marketId,1);assert.equal(f.calls[0].key,f.calls[1].key);assert.equal(f.calls[0].origin,'scheduler');
  assert.match(f.calls[0].expectedSourceHash,/^[a-f0-9]{64}$/);assert.equal(f.calls[0].evidence.finalScore,'2-1');
  const runs=(await f.db.query('SELECT status,report FROM sepolia_resolver_runs')).rows;assert.equal(runs.length,2);assert.equal(runs[0].status,'ok');
});
test('pending signed requests resume before new evidence; no new intent until reconciliation',async t=>{
  const f=await fixture(t);await f.seed(1);
  const input={marketId:91,action:'resolve',outcome:1,reason:'Scheduled verified source resolution',origin:'scheduler'};
  await f.db.query(`INSERT INTO sepolia_trade_requests VALUES('auto_original',421614,$1,'ops','admin_resolve',$2,'pending',now())`,[env.ONCHAIN_RESOLVER_ADDRESS.toLowerCase(),JSON.stringify(input)]);
  const r=await f.run({settle:async args=>{f.calls.push(args);return {httpStatus:202,body:{txHash:'0xpending'}};}});
  assert.equal(r.pending.length,1);assert.equal(f.decisions.length,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].key,'auto_original');assert.equal(f.calls[0].input.marketId,91);
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
