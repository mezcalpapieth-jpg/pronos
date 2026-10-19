import test from 'node:test';
import assert from 'node:assert/strict';
import { createStandingsWorker,validateStandingsWorker } from './worker.js';

const source={branch:'onchain-sepolia',sha:'a'.repeat(40)};
const env={VERCEL_ENV:'production',VERCEL_PROJECT_ID:'dedicated',PREVIEW_STANDINGS_PROJECT_ID:'dedicated',CHAIN_ID:'421614',
  DATABASE_URL:'postgres://sepolia_standings@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ARB_RPC_URL:'https://rpc.invalid',CRON_SECRET:'s'.repeat(32),STANDINGS_POLICY_HASH:'a'.repeat(64),ONCHAIN_STANDINGS_ENABLED:'true'};
const run=async({vars=env,req={},tick=()=>assert.fail('must not run')}={})=>{
  const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
  await createStandingsWorker({env:vars,source,tick})({method:'GET',headers:{authorization:`Bearer ${env.CRON_SECRET}`},...req},res);return res;
};
test('worker is disabled by default and authenticates without query, method or user-agent bypass',async()=>{
  assert.equal((await run({vars:{...env,ONCHAIN_STANDINGS_ENABLED:undefined}})).body.status,'disabled');
  assert.equal((await run({req:{method:'POST'}})).code,405);
  assert.equal((await run({req:{headers:{'user-agent':'vercel-cron/1.0'},query:{key:env.CRON_SECRET}}})).code,401);
  assert.equal((await run({req:{headers:{authorization:'Bearer bad'}}})).code,401);
});
test('project, branch, isolated role/endpoint, RPC and signing-credential guards precede the tick',async()=>{
  validateStandingsWorker(env,source);
  for(const change of [{VERCEL_ENV:'preview'},{PREVIEW_STANDINGS_PROJECT_ID:'other'},{CHAIN_ID:'1'},
    {DATABASE_URL:'postgres://sepolia_standings@production/db'},
    {DATABASE_URL:env.DATABASE_URL.replace('sepolia_standings','neondb_owner')},{ARB_RPC_URL:'http://rpc.invalid'},
    {CRON_SECRET:'short'},{STANDINGS_POLICY_HASH:'bad'},{TURNKEY_API_PUBLIC_KEY:'forbidden'},{DEPLOYER_PRIVATE_KEY:'forbidden'}]) {
    assert.throws(()=>validateStandingsWorker({...env,...change},source));
  }
  assert.throws(()=>validateStandingsWorker(env,{...source,branch:'pointbreak'}));
  assert.equal((await run({vars:{...env,VERCEL_ENV:'preview'}})).code,500);
});
test('authorized invocations run once, return safe progress and redact provider failures',async()=>{
  let calls=0;const result=await run({tick:async()=>{calls++;return {status:'paused',newReads:200};}});
  assert.equal(calls,1);assert.equal(result.body.status,'paused');
  const failed=await run({tick:async()=>{throw Error('postgres://secret@private');}});
  assert.equal(failed.code,500);assert.doesNotMatch(JSON.stringify(failed.body),/secret|postgres|private/);
});
