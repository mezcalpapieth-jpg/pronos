import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefundHandler} from './onchain-refunds.js';
import {preview} from '../../_lib/test-support/sepolia-settlement.mjs';
const holder='0x'+'5'.repeat(40),body={operation:'preview',marketId:42,holders:[holder]};let seq=0;
function fixture(options={}) {
  const calls=[],handler=createRefundHandler({env:preview,sqlFor:()=>({fixture:true}),adminFor:()=>({username:`refund-admin-${seq++}`}),
    providerFor:()=>({fixture:true}),preview:async a=>{calls.push(a);return {planHash:'review'};},
    execute:async a=>{calls.push(a);return {httpStatus:202,body:{status:'pending'}};},...options});
  const res={setHeader(){},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};
  return {calls,res,run:r=>handler({method:'POST',headers:{},body,...r},res)};
}
test('refund API rejects branch overrides, raw payouts and execution without a review/key before opening SQL',async()=>{
  for(const [options,req,status] of [[{env:{...preview,VERCEL_GIT_COMMIT_REF:'pointbreak'}},{},403],
    [{},{body:{...body,payout:'999'}},400],[{},{query:{factory:'forged'}},400],[{},{body:{...body,operation:'execute'}},400],
    [{adminFor:(_q,r)=>{r.status(401).json({error:'unauthorized'});}},{},401]]) {
    const f=fixture({...options,sqlFor:()=>{throw Error('must not connect');}});await f.run(req);assert.equal(f.res.code,status);assert.equal(f.calls.length,0);
  }
});
test('preview never signs; execution receives normalized reviewed data and durable key',async()=>{
  const f=fixture();await f.run();assert.equal(f.res.code,200);assert.deepEqual(f.calls[0].input,{marketId:42,holders:[holder]});assert.equal(f.calls[0].sign,undefined);
  await f.run({body:{...body,operation:'execute',reason:'Reviewed',blockNumber:10,blockHash:'0x'+'ab'.repeat(32),planHash:'a'.repeat(64),requestId:'refund_request_123'}});
  assert.equal(f.res.code,202);assert.equal(f.calls[1].key,'refund_request_123');assert.ok(f.calls[1].actor);
});
test('refund API sanitizes raw failures',async()=>{
  const f=fixture({preview:async()=>{throw Error('https://private:secret@rpc.invalid');}});await f.run();assert.equal(f.res.code,503);assert.equal(f.res.body.error,'onchain_refunds_unavailable');
});
