import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {ethers} from 'ethers';
import {readFile} from 'node:fs/promises';
import {TRADE_REQUEST_SCHEMA} from './trade-request-store.js';
import {SETTLEMENT_MIGRATION} from './onchain-admin-settlement.js';
import {preview} from './test-support/sepolia-settlement.mjs';
import {refundInput,previewCancelRefunds,executeCancelRefunds,assertRefundReceipt} from './onchain-cancel-refunds.js';
import {simulateContractCall} from './onchain-simulation.js';
import {createSettlementHandler} from '../points/admin/onchain-settlement.js';
const addr=n=>`0x${String(n).repeat(40)}`,holder=addr(5),pool=addr(4),hash='0x'+'ab'.repeat(32);
const owner=new ethers.Wallet('0x'+'12'.repeat(32));
const iface=new ethers.utils.Interface(['function pushCancelRefund(uint256,address[],uint8[][],uint256[][],uint256[])',
  'event CancelRefundPushed(uint256 indexed marketId,address indexed holder,uint256 payout)']);
async function fixture(t,{variant='v1',timeout=false}={}) {
  const db=new PGlite();t.after(()=>db.close());for(const ddl of [...TRADE_REQUEST_SCHEMA,...SETTLEMENT_MIGRATION])await db.exec(ddl);
  await db.exec(`CREATE TABLE points_markets(id int,mode text,chain_id int,chain_address text,chain_market_id text,parent_id int,amm_mode text,question text);
    CREATE TABLE protocol_markets(id int,chain_id int,factory_address text,pool_address text,market_id bigint,protocol_version text,outcome_count int,status text,outcome int,resolver_config jsonb,resolver_type text,outcomes jsonb);
    INSERT INTO points_markets VALUES(42,'onchain',421614,'${pool}','0',null,'unified','Fixture');
    INSERT INTO protocol_markets VALUES(99,421614,'${addr(variant==='v2'?2:1)}','${pool}',0,'${variant}',${variant==='v2'?3:2},'canceled',null,'{}','sports_api','[]');`);
  const sql=async(parts,...values)=>(await db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values)).rows;
  let basis=9000000n,balance=10000000n,poolCash=10000000n,nonce=0,receipt=null,ready=!timeout,anchor=hash;
  const signed=[],sent=[],reads=[];
  const provider={getNetwork:async()=>({chainId:421614}),getBlock:async()=>({number:10,hash:anchor,timestamp:100}),
    getBalance:async()=>ethers.utils.parseEther('1'),getGasPrice:async()=>ethers.BigNumber.from(10000000),
    getTransactionCount:async(_a,tag)=>nonce+(tag==='pending'&&sent.length&&!ready?1:0),getTransactionReceipt:async()=>ready?receipt:null,
    waitForTransaction:async()=>ready?receipt:null,sendTransaction:async raw=>{sent.push(raw);const tx=ethers.utils.parseTransaction(raw),a=iface.parseTransaction(tx).args;
      receipt={transactionHash:tx.hash,status:1,blockNumber:11,logs:a[1].map((h,i)=>({address:tx.to,...iface.encodeEventLog(iface.getEvent('CancelRefundPushed'),[a[0],h,a[4][i]])}))};if(ready)nonce++;}};
  const contractAt=(address)=>address===pool?{canceled:async()=>true,token:async()=>addr(6),collateral:async()=>addr(3),costBasis:async(_h,i,at)=>{reads.push(at);return i===0?basis:0n;}}
    :address===addr(6)?{tokenId:async(_id,i)=>i,yesTokenId:async()=>0,noTokenId:async()=>1,balanceOf:async(_h,i,at)=>{reads.push(at);return i===0?balance:0n;}}
    :address===addr(3)?{balanceOf:async()=>poolCash}:{getMarket:async()=>[pool],collateral:async()=>addr(3)};
  const input={marketId:42,holders:[holder]};
  const dependencies={sql,provider,env:preview,input,contractAt};
  const review=await previewCancelRefunds(dependencies);
  const sign=async({unsignedTx})=>{signed.push(unsignedTx);return owner.signTransaction(ethers.utils.parseTransaction(unsignedTx));};
  const dispatch=async a=>{const r=a.execution.receipt||await a.execution.send({suborgId:a.ownerSuborgId,from:a.ownerAddr,to:a.factoryAddress,step:'trade',gasLimit:370000,
    data:iface.encodeFunctionData('pushCancelRefund',[a.marketId,a.refunds.map(r=>r.holder),a.refunds.map(r=>r.outcomeIndexes),a.refunds.map(r=>r.amounts.map(n=>ethers.utils.parseUnits(n,6))),a.refunds.map(r=>ethers.utils.parseUnits(r.payout,6))])});return {txHash:r.transactionHash,blockNumber:r.blockNumber};};
  const executeInput={...input,blockNumber:review.blockNumber,blockHash:review.blockHash,planHash:review.planHash,reason:'Reviewed native costs'};
  return {db,review,reads,signed,sent,dependencies,executeInput,provider,
    change(o){if(o.basis!=null)basis=o.basis;if(o.balance!=null)balance=o.balance;if(o.poolCash!=null)poolCash=o.poolCash;if(o.anchor)anchor=o.anchor;if(o.ready){ready=true;nonce=1;}},
    run:(extra={})=>executeCancelRefunds({...dependencies,input:executeInput,key:'refund_request_123',actor:'admin',sign,dispatch,...extra})};
}
test('strict reviewed input rejects browser payouts, duplicate/zero holders and forged hashes',()=>{
  const valid={operation:'preview',marketId:42,holders:[holder]};assert.deepEqual(refundInput(valid),{marketId:42,holders:[holder]});
  for(const change of [{payout:'9'},{holders:[holder,holder]},{holders:[ethers.constants.AddressZero]},{holders:Array(6).fill(holder)},{marketId:'42'},{operation:'execute'}])assert.throws(()=>refundInput({...valid,...change}));
});
for(const variant of ['v1','v2'])test(`${variant} refund is calculated at one anchor and pays once across timeout and indexed state changes`,async t=>{
  const f=await fixture(t,{variant,timeout:true});assert.equal(f.review.payoutUnits,'9000000');assert.equal(f.review.refunds[0].amounts[0],'10000000');assert.ok(f.reads.every(r=>r.blockTag===10));
  const first=await f.run();assert.equal(first.httpStatus,202);assert.equal(f.signed.length,1);
  f.change({basis:0n,balance:0n,ready:true});const replay=await f.run();assert.equal(replay.httpStatus,200);assert.equal(replay.body.refundsPaid,true);assert.equal(replay.body.txHash,first.body.txHash);
  assert.equal(f.signed.length,1);assert.equal(f.sent.length,1);assert.equal((await f.run()).body.txHash,first.body.txHash);
  await assert.rejects(f.run({input:{...f.executeInput,reason:'Different review'}}),/idempotency_key_conflict/);
});
test('changed balance, changed anchor, pool shortfall and no cost basis never sign',async t=>{
  for(const change of [{balance:1n},{basis:1n},{poolCash:1n},{anchor:'0x'+'cd'.repeat(32)},{basis:0n}]) {
    const f=await fixture(t);f.change(change);const r=await f.run();assert.equal(r.httpStatus,409);assert.equal(f.signed.length,0);
  }
});
test('external gifts without native basis receive no payout; an already refunded holder is skipped',async t=>{
  const f=await fixture(t);f.change({basis:0n});let r=await previewCancelRefunds(f.dependencies);assert.equal(r.refunds.length,0);assert.equal(r.skipped[0].reason,'no_native_cost_basis');
  f.change({balance:0n});r=await previewCancelRefunds(f.dependencies);assert.equal(r.skipped[0].reason,'no_open_shares');
});
test('receipt requires exact factory, market, holder and payout, with no duplicates',async t=>{
  const f=await fixture(t),log=iface.encodeEventLog(iface.getEvent('CancelRefundPushed'),[0,holder,'9000000']),receipt={status:1,logs:[{address:f.review.factory,...log}]};
  assertRefundReceipt(f.review,receipt);
  for(const bad of [{...receipt,status:0},{...receipt,logs:[]},{...receipt,logs:[...receipt.logs,...receipt.logs]},{...receipt,logs:[{address:pool,...log}]}])assert.throws(()=>assertRefundReceipt(f.review,bad));
});
test('admin refund indexing requires one exact indexed payout per reviewed recipient',async t=>{
  const f=await fixture(t),result=await f.run();assert.equal(result.httpStatus,200);
  await f.db.exec(`CREATE TABLE indexer_factory_state(chain_id int,factory_address text,last_block bigint);
    CREATE TABLE sepolia_resolver_runs(status text,started_at timestamptz,completed_at timestamptz,report jsonb);
    CREATE TABLE redemptions(market_id int,user_address text,outcome_index int,shares numeric,payout numeric,tx_hash text);
    INSERT INTO indexer_factory_state VALUES(421614,'${addr(1)}',20);`);
  const handler=createSettlementHandler({env:preview,sqlFor:()=>f.dependencies.sql,adminFor:()=>({username:'refund-index-admin'})});
  const inspect=async()=>{
    const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await handler({method:'GET',headers:{},query:{}},res);
    assert.equal(res.code,200,JSON.stringify(res.body));return res.body.requests[0];
  };
  let row=await inspect();assert.equal(row.awaitingIndexing,true);assert.equal(row.indexingStatus,'pending_or_superseded');
  await f.db.query('INSERT INTO redemptions VALUES(99,$1,NULL,0,8,$2)',[holder,result.body.txHash]);
  assert.equal((await inspect()).awaitingIndexing,true);
  await f.db.exec('UPDATE redemptions SET payout=9');
  row=await inspect();assert.equal(row.awaitingIndexing,false);assert.equal(row.indexingStatus,'indexed');
  assert.equal(row.input.planHash,f.review.planHash);assert.equal(row.input.payout,undefined);
  await f.db.query('INSERT INTO redemptions VALUES(99,$1,NULL,0,9,$2)',[holder,result.body.txHash]);
  assert.equal((await inspect()).awaitingIndexing,true);
});
test('real refund dispatcher passes execution through, skips consumed-share simulation on receipt replay, and rejects returned revert bytes',async()=>{
  const source=await readFile(new URL('./onchain-trader.js',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('function normalizeCancelRefund')).replace('export async','async');
  let sent=0,simulated=0;const bindings={ethers,requireReady(){},factoryAbiForVariant:()=>iface.fragments,
    requireFactoryOwner:async()=>{},parseMarketId:ethers.BigNumber.from,COLLATERAL_DECIMALS:6,
    provider:()=>({call:async()=>{simulated++;return '0x08c379a0'+ethers.utils.defaultAbiCoder.encode(['string'],['failed']).slice(2);}}),
    simulateContractCall,extractRevertDetail:e=>e.message,chainId:()=>421614,formatCollateral:n=>ethers.utils.formatUnits(n,6),
    signAndBroadcast:async()=>{sent++;throw Error('must not sign');}};
  const run=new Function(...Object.keys(bindings),code+';return pushCancelRefundsOnChain;')(...Object.values(bindings));
  const args={ownerSuborgId:'ops',ownerAddr:owner.address,factoryAddress:addr(1),factoryVariant:'v1',marketId:0,refunds:[{holder,outcomeIndexes:[0],amounts:['10'],payout:'9'}]};
  await assert.rejects(run(args),/factory_cancel_refund_simulation_failed/);assert.equal(sent,0);
  const r=await run({...args,execution:{receipt:{transactionHash:'0xoriginal',blockNumber:11}}});assert.equal(r.txHash,'0xoriginal');assert.equal(simulated,1);
});
