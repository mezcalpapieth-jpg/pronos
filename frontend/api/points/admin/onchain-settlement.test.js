import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettlementHandler} from './onchain-settlement.js';
import {preview} from '../../_lib/test-support/sepolia-settlement.mjs';
const body={marketId:42,action:'resolve',outcome:0,reason:'Verified source',requestId:'admin_request_123'};
let seq=0;
function fixture(options={}){
  const calls=[],queries=[];
  const sql=async parts=>{queries.push(parts.join(''));return [];};
  const handler=createSettlementHandler({env:preview,adminFor:()=>({username:`admin-${seq++}`}),sqlFor:()=>sql,
    providerFor:()=>({fixture:true}),settle:async args=>{calls.push(args);return {httpStatus:202,body:{status:'pending',txHash:'0xhash'}};},...options});
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(b){this.body=b;return this;}};
  return {res,calls,queries,run:req=>handler({method:'POST',headers:{},body,...req},res)};
}
test('admin endpoint is private and rejects unauthenticated/disabled/override/invalid-key calls before SQL or signing',async()=>{
  for(const [options,req,status] of [
    [{adminFor:(_r,res)=>{res.status(401).json({error:'not_authenticated'});return null;}},{},401],
    [{env:{...preview,ONCHAIN_ADMIN_SETTLEMENT_ENABLED:'false'}},{},403],
    [{env:{...preview,VERCEL_GIT_COMMIT_REF:'pointbreak'}},{},403],
    [{},{query:{factory:'forged'}},400],[{},{body:{...body,factoryAddress:'forged'}},400],
    [{},{body:{...body,requestId:undefined}},400],[{},{headers:{'idempotency-key':'different_key'}},400]]){
    const f=fixture({...options,sqlFor:()=>{throw Error('SQL must not open');}});await f.run(req);assert.equal(f.res.code,status);assert.equal(f.calls.length,0);assert.equal(f.res.headers['Cache-Control'],'private, no-store');
  }
});
test('admin endpoint sends whitelisted input, durable key and authenticated actor only',async()=>{
  const f=fixture();await f.run();assert.equal(f.res.code,202);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].key,body.requestId);assert.deepEqual(f.calls[0].input,{marketId:42,action:'resolve',outcome:0,reason:'Verified source'});assert.match(f.calls[0].actor,/^admin-/);
});
test('admin GET returns only safe request metadata and distinguishes confirmations from indexed state',async()=>{
  const factory=preview.ONCHAIN_MARKET_FACTORY_ADDRESS,pool=`0x${'4'.repeat(40)}`;
  const market={points_id:42,mode:'onchain',points_chain_id:421614,chain_id:421614,chain_address:pool,pool_address:pool,chain_market_id:'0',contract_id:'0',protocol_id:99,protocol_version:'v1',factory_address:factory,status:'resolved',outcome:1,outcomes:['Yes','No'],indexed_block:'12'};
  const request={request_key:'admin_request_123',market_id:'42',action:'admin_resolve',status:'confirmed',requested_outcome:0,reason:'Evidence',result:{outcome:0},block_number:'10',tx_hash:'0xhash',signed_tx:'secret-bytes',payload:{suborg:'secret-suborg'}};
  const sql=async parts=>parts.join('').includes('FROM points_markets')?[market]:parts.join('').includes('FROM sepolia_resolver_runs')?[]:[request];
  const f=fixture({sqlFor:()=>sql});await f.run({method:'GET'});assert.equal(f.res.code,200);assert.equal(f.res.body.requests[0].indexingStatus,'indexed');
  assert.doesNotMatch(JSON.stringify(f.res.body),/secret-bytes|secret-suborg|signed_tx/);
  assert.equal(f.res.body.requests[0].awaitingIndexing,false);
  market.indexed_block='9';await f.run({method:'GET'});assert.equal(f.res.body.requests[0].indexingStatus,'pending_or_superseded');assert.equal(f.res.body.requests[0].awaitingIndexing,true);
  market.chain_market_id='8';await f.run({method:'GET'});assert.equal(f.res.body.markets[0].settlementReady,false);
});
test('raw provider/database/signer errors never escape the admin endpoint',async()=>{
  for(const message of ['https://private:credential@rpc.invalid','invalid_argument: private-credential','onchain_error (private RPC URL)']){
    const f=fixture({settle:async()=>{throw Error(message);}});await f.run();assert.equal(f.res.code,503);assert.equal(f.res.body.error,'onchain_settlement_unavailable');
  }
});

test('refund confirmation remains awaiting indexing until exact recipient payouts are recorded',async()=>{
  const factory=preview.ONCHAIN_MARKET_FACTORY_ADDRESS,pool=`0x${'4'.repeat(40)}`;
  const market={points_id:42,mode:'onchain',points_chain_id:421614,chain_id:421614,chain_address:pool,pool_address:pool,chain_market_id:'0',contract_id:'0',protocol_id:99,protocol_version:'v1',factory_address:factory,status:'canceled',indexed_block:'12'};
  const request={request_key:'refund_request_123',market_id:'42',action:'admin_cancel_refund',status:'confirmed',reason:'Reviewed',block_number:'10',tx_hash:'0xhash',
    request_payload:{holders:['0x'+'5'.repeat(40)],blockNumber:9,blockHash:'0x'+'ab'.repeat(32),planHash:'a'.repeat(64)},refunds_indexed:false};
  const sql=async parts=>parts.join('').includes('FROM points_markets')?[market]:parts.join('').includes('FROM sepolia_resolver_runs')?[]:[request];
  const f=fixture({sqlFor:()=>sql});await f.run({method:'GET'});assert.equal(f.res.body.requests[0].awaitingIndexing,true);assert.equal(f.res.body.requests[0].indexingStatus,'pending_or_superseded');
  request.refunds_indexed=true;await f.run({method:'GET'});assert.equal(f.res.body.requests[0].awaitingIndexing,false);assert.equal(f.res.body.requests[0].indexingStatus,'indexed');
  assert.equal(f.res.body.requests[0].input.planHash,request.request_payload.planHash);
});
