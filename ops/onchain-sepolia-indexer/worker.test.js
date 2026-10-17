import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, validateWorker } from './worker.js';
const source = { branch: 'onchain-sepolia', sha: 'a'.repeat(40) };
const env = {
  VERCEL_ENV:'production', VERCEL_PROJECT_ID:'dedicated', PREVIEW_INDEXER_PROJECT_ID:'dedicated',
  DATABASE_URL:'postgresql://sepolia_indexer:synthetic@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  CHAIN_ID:'421614', PROTOCOL_CHAIN_ID:'421614', CRON_SECRET:'synthetic-secret-only-for-tests-123456',
  FACTORY_ADDRESS:'0x69440742a168635d9fa7cc0cfb0935afffe79ad3', FACTORY_V2_ADDRESS:'0xfcac9cfcf22df809ba365c85dd767c90bb260fd6',
};
const request = { method:'GET', headers:{authorization:`Bearer ${env.CRON_SECRET}`,'user-agent':'vercel-cron/1.0','x-vercel-cron-schedule':'* * * * *'}, query:{resolve:'1',fromBlock:'0'} };
function setup({ lease=true, chain=421614, fail=false, environment=env }={}) {
  const queries=[]; let calls=0;
  const sql=async (parts,...values)=>{const query=parts.join('?'); queries.push({query,values});return query.includes('RETURNING owner') ? (lease?[{owner:values[0]}]:[]) : [];};
  const worker=createWorker({env:environment,source,sql,chainId:async()=>chain,index:async(...args)=>{calls++;assert.deepEqual(args,[]);if(fail)throw Error('private provider information');return{status:'ok',processed:{trades:1,resolutions:1,redemptions:1}};}});
  const res={setHeader(){},status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};
  return{worker,res,queries,calls:()=>calls};
}
test('isolation pins project, chain, database role/branch, factories and signing-credential absence',()=>{
  assert.doesNotThrow(()=>validateWorker(env,source));
  for(const patch of [{VERCEL_PROJECT_ID:'main-app'},{VERCEL_ENV:'preview'},{CHAIN_ID:'42161'},
    {DATABASE_URL:env.DATABASE_URL.replace('delicate-glitter','production')},
    {DATABASE_URL:env.DATABASE_URL.replace('sepolia_indexer','neondb_owner')},
    {FACTORY_ADDRESS:`0x${'0'.repeat(40)}`},{TURNKEY_API_PRIVATE_KEY:'synthetic'}]) {
    assert.throws(()=>validateWorker({...env,...patch},source));
  }
  assert.throws(()=>validateWorker(env,{...source,branch:'pointbreak'}));
  assert.doesNotThrow(()=>validateWorker({...env,ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS:env.FACTORY_ADDRESS,ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS:env.FACTORY_V2_ADDRESS},source));
  assert.throws(()=>validateWorker({...env,ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS:`0x${'1'.repeat(40)}`},source));
});
test('unauthenticated requests and wrong methods never reach RPC, SQL or indexing',async()=>{
  for(const patch of [{headers:{}},{method:'POST'}]) {
    const s=setup();await s.worker({...request,...patch},s.res);assert.ok([401,405].includes(s.res.statusCode));assert.equal(s.queries.length,0);assert.equal(s.calls(),0);
  }
});
test('wrong RPC chain fails before database writes',async()=>{
  const s=setup({chain:42161});await s.worker(request,s.res);assert.equal(s.res.statusCode,500);assert.equal(s.queries.length,0);assert.equal(s.calls(),0);
});
test('overlap skips the indexer and cannot release another run lease',async()=>{
  const s=setup({lease:false});await s.worker(request,s.res);assert.equal(s.res.data.reason,'already_running');assert.equal(s.calls(),0);assert.equal(s.queries.length,1);
});
test('scheduled run ignores query overrides, records protocol events and releases only its lease',async()=>{
  const s=setup();await s.worker(request,s.res);assert.equal(s.res.statusCode,200);assert.equal(s.calls(),1);assert.equal(s.res.data.protocolOnly,true);
  const insert=s.queries.find(q=>q.query.includes('INSERT INTO preview_indexer_runs'));assert.equal(insert.values[2],'cron');
  const result=s.queries.find(q=>q.query.includes("status = 'ok'"));assert.equal(JSON.parse(result.values[0]).processed.redemptions,1);
  assert.match(s.queries.at(-1).query,/AND owner = \?/);assert.equal(s.queries.at(-1).values[0],insert.values[0]);
});
test('failure stores no sensitive error and releases its lease for later retries',async()=>{
  const s=setup({fail:true});await s.worker(request,s.res);assert.equal(s.res.statusCode,500);assert.equal(s.res.data.error,'indexer_failed');assert.ok(s.queries.some(q=>q.query.includes("status = 'error'")));assert.ok(!JSON.stringify(s.queries).includes('private provider information'));assert.match(s.queries.at(-1).query,/AND owner = \?/);
});
