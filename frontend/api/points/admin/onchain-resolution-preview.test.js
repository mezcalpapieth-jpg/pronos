import test from 'node:test';
import assert from 'node:assert/strict';
import {createResolutionPreviewHandler} from './onchain-resolution-preview.js';
import {preview} from '../../_lib/test-support/sepolia-settlement.mjs';
let seq=0;
test('source preview is admin-only, read-only and usable with signing scheduling disabled',async()=>{
  let opened=0;
  const fixture=(env,adminFor)=>{
    const res={setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};
    const handler=createResolutionPreviewHandler({env,adminFor:adminFor||(()=>({username:`inspect-${seq++}`})),sqlFor:()=>{opened++;return {};},providerFor:()=>({}),
      inspect:async args=>{assert.equal(args.sign,undefined);return {mode:'read_only',transactionsSubmitted:0};},
      review:async args=>{assert.equal(args.sign,undefined);return {marketId:args.marketId};}});
    return {res,run:r=>handler({method:'GET',headers:{},...r},res)};
  };
  const env={...preview,VERCEL_GIT_COMMIT_SHA:'a'.repeat(40),ONCHAIN_RESOLVER_SCHEDULE_ENABLED:'false'};
  const f=fixture(env);await f.run();assert.equal(f.res.code,200);assert.equal(f.res.body.transactionsSubmitted,0);assert.equal(opened,1);
  for(const [changes,req,status] of [[{VERCEL_ENV:'production'},{},403],[{VERCEL_GIT_COMMIT_REF:'pointbreak'},{},403],
    [{},{query:{marketId:'1',outcome:'0'}},400],[{},{query:{marketId:['1','2']}},400],[{},{query:{marketId:'2147483648'}},400],[{},{method:'POST'},405]]) {
    const g=fixture({...env,...changes});await g.run(req);assert.equal(g.res.code,status);assert.equal(opened,1);
  }
  await f.run({query:{marketId:'456'}});assert.equal(f.res.code,200);assert.equal(f.res.body.marketId,456);assert.equal(opened,2);
});
