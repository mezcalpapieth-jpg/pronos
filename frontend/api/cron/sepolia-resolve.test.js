import test from 'node:test';
import assert from 'node:assert/strict';
import {createResolverHandler} from './sepolia-resolve.js';
import {preview} from '../_lib/test-support/sepolia-settlement.mjs';
const env={...preview,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'true',VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),ONCHAIN_RESOLVER_CRON_SECRET:'t'.repeat(32)};
function fixture(change={}){
  let opened=0,runs=0;
  const handler=createResolverHandler({env,sqlFor:()=>{opened++;return {};},providerFor:()=>({}),run:async()=>{runs++;return {status:'ok'};},...change});
  const res={setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;}};
  return {res,get opened(){return opened;},get runs(){return runs;},run:r=>handler({method:'POST',headers:{authorization:`Bearer ${env.ONCHAIN_RESOLVER_CRON_SECRET}`,'x-pronos-resolver-source':env.VERCEL_GIT_COMMIT_SHA},body:{},query:{},...r},res)};
}
test('resolver rejects unauthorized, stale-source and override triggers before opening SQL',async()=>{
  for(const [req,status] of [[{headers:{}},401],[{headers:{authorization:`Bearer ${env.ONCHAIN_RESOLVER_CRON_SECRET}`,'x-pronos-resolver-source':'b'.repeat(40)}},409],[{query:{dry:'true'}},400],[{body:{marketId:42}},400],[{method:'GET'},405]]){
    const f=fixture();await f.run(req);assert.equal(f.res.code,status);assert.equal(f.opened,0);assert.equal(f.runs,0);
  }
});
test('resolver defaults off and isolates production while valid preview delegates to the runner',async()=>{
  const disabled=fixture({env:{...env,ONCHAIN_RESOLVER_SCHEDULE_ENABLED:undefined}});await disabled.run();assert.equal(disabled.res.body.status,'disabled');assert.equal(disabled.opened,0);
  const production=fixture({env:{...env,VERCEL_ENV:'production'}});await production.run();assert.equal(production.res.code,503);assert.equal(production.opened,0);
  const f=fixture();await f.run();assert.equal(f.res.code,200);assert.equal(f.runs,1);
});
