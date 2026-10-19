import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';
import { buildTournamentShadowScores } from './sepolia-tournament-scoring.js';
import { fixture, addr, hash } from './sepolia-tournament-test-fixture.js';

const ZERO=ethers.constants.AddressZero;
const run=f=>buildTournamentSnapshot(f.input,f.options);
const alice=result=>result.scores.rows.find(r=>r.username==='alice');
function cashGift(f,amount='100000000',block=125,from=addr(91),to=addr(30)) {
  return f.addReceipt(hash(10000+block),block,[f.cashLog(from,to,amount)]);
}
function shareGift(f,{v=1,amount='90000000',block=126,from=addr(99),to=addr(30),outcome=v===1?0:2,batch=false}={}) {
  return f.addReceipt(hash(20000+block),block,[batch
    ?f.encoded(f.sharesAbi,'TransferBatch',[from,from,to,[outcome],[amount]],addr(3+v))
    :f.shareLog(v,from,to,outcome,amount,0,from)]);
}
function trade(f,{side,amount,quantity,v=1,block=150,wallet=addr(30),offset=0,tx=hash(30000+block),operator=addr(6)}={}) {
  const pool=addr(39+v),outcome=v===1?0:2,abi=f.eventAbis[v],buy=side==='buy',redeem=side==='redeem';
  const legs=[f.shareLog(v,buy?pool:wallet,buy?wallet:redeem?ZERO:pool,outcome,quantity,offset+(buy?1:0),redeem?pool:operator),
    f.cashLog(buy?wallet:pool,buy?pool:wallet,amount,offset+(buy?0:1))];
  legs.sort((a,b)=>a.logIndex-b.logIndex);
  return f.addReceipt(tx,block,[...legs,f.encoded(abi,buy?'SharesBought':redeem?'WinningsRedeemed':'SharesSold',
    [wallet,...(redeem?(v===2?[outcome]:[]):[v===1?true:outcome]),...(buy?[amount,0,quantity]:redeem?[quantity,amount]:[quantity,amount,0])],pool,offset+2)]);
}
function cancel(f,v=1) {
  f.contracts.get(addr(39+v)).state.canceled=true;
  f.addReceipt(hash(40000+v),130,[f.encoded(f.eventAbis[v],'MarketCanceled',[0],addr(39+v))]);
}
function refund(f,{v=1,quantity,amount,block=140}={}) {
  const pool=addr(39+v);
  f.addReceipt(hash(50000+block),block,[f.shareLog(v,addr(30),ZERO,v===1?0:2,quantity),
    ...(BigInt(amount)?[f.cashLog(pool,addr(30),amount,1)]:[]),f.encoded(f.eventAbis[v],'CancelRefunded',[addr(30),amount],pool,2)]);
}

test('incoming cash and ERC1155 gifts are excluded; the exact movement report is reproducible',async()=>{
  const f=fixture(),baseline=await run(f);cashGift(f);shareGift(f,{batch:true});
  const result=await run(f),row=alice(result);
  assert.equal(row.equityUnits,alice(baseline).equityUnits);
  assert.equal(row.actualCashUnits,'485000000');assert.equal(row.excludedCashUnits,'100000000');
  assert.equal(result.scores.actualPositions[0].sharesUnits,'180000000');
  assert.equal(result.scores.accountingPositions[0].sharesUnits,'90000000');
  assert.equal(result.scores.transferReconciliation.externalMovements.length,2);
  assert.equal(result.scores.transferReconciliation.historicalBalancesVerified,true);
  assert.equal(result.version,2);assert.equal(result.readyForRewards,false);
  assert.deepEqual(await run(f),result);
});

test('outgoing cash/shares reduce the sender; returning them cannot restore eligibility',async()=>{
  const f=fixture();cashGift(f,'100000000',125,addr(30),addr(99));
  shareGift(f,{amount:'45000000',from:addr(30),to:addr(99)});
  const sent=await run(f);assert.equal(alice(sent).cashUnits,'285000000');
  assert.equal(sent.scores.accountingPositions[0].sharesUnits,'45000000');
  cashGift(f,'100000000',127,addr(99));shareGift(f,{amount:'45000000',block:128});
  const returned=await run(f);assert.equal(alice(returned).equityUnits,alice(sent).equityUnits);
  assert.equal(alice(returned).actualCashUnits,'385000000');assert.equal(alice(returned).excludedCashUnits,'100000000');
});

test('transfers between registrants debit the sender and never credit the recipient score',async()=>{
  const f=fixture({planOptions:{users:[{username:'alice',wallet_address:addr(30),turnkey_sub_org_id:'alice'},
    {username:'bob',wallet_address:addr(31),turnkey_sub_org_id:'bob'}],maxTotalMxnp:'2000'}});
  cashGift(f,'100000000',125,addr(30),addr(31));shareGift(f,{from:addr(30),to:addr(31)});
  const result=await run(f),bob=result.scores.rows.find(r=>r.username==='bob');
  assert.equal(alice(result).cashUnits,'285000000');assert.equal(result.scores.accountingPositions.find(p=>p.wallet===addr(30)).sharesUnits,'0');
  assert.equal(bob.equityUnits,'500000000');assert.equal(bob.actualCashUnits,'600000000');
  assert.equal(result.scores.accountingPositions.find(p=>p.wallet===addr(31)).sharesUnits,'0');
});

test('mixed capital buys, routed sales and redemptions credit only eligible proportions',async()=>{
  const f=fixture();cashGift(f,'385000000');
  trade(f,{side:'buy',amount:'100000000',quantity:'200000000',block:140});
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===0?150000000:0;
  const bought=await run(f);assert.equal(alice(bought).cashUnits,'335000000');
  assert.equal(bought.scores.accountingPositions[0].sharesUnits,'190000000');
  trade(f,{side:'sell',amount:'72500000',quantity:'145000000'});
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===0?75000000:0;
  const sold=await run(f);assert.equal(alice(sold).cashUnits,'382500000');
  assert.equal(sold.scores.accountingPositions[0].sharesUnits,'95000000');
  assert.equal(alice(sold).equityUnits,'486666610');
  f.contracts.get(addr(40)).state.resolved=true;f.contracts.get(addr(40)).state.outcome=1;
  f.addReceipt(hash(40001),160,[f.encoded(f.eventAbis[1],'MarketResolved',[0,1],addr(40))]);
  trade(f,{side:'redeem',amount:'145000000',quantity:'145000000',block:170});
  const redeemed=await run(f);assert.equal(alice(redeemed).cashUnits,'477500000');
  assert.equal(redeemed.scores.actualPositions[0].costBasisUnits,'75000000','redemption retains actual contract basis');
  assert.equal(redeemed.scores.accountingPositions[0].sharesUnits,'0');
});

test('gifted winning shares and their V1/V2 redemption proceeds remain excluded',async()=>{
  for(const v of [1,2]) {
    const f=fixture({resolved:true});shareGift(f,{v,block:145,batch:v===2});
    trade(f,{v,side:'redeem',amount:'90000000',quantity:'90000000'});
    const result=await run(f);assert.equal(alice(result).cashUnits,'645000000');
    assert.equal(alice(result).actualCashUnits,'735000000');
    assert.equal(alice(result).excludedCashUnits,'90000000');
  }
});

test('V2 mixed-funded buys/sales and purchases beyond the eligible cash balance reconcile',async()=>{
  const f=fixture();cashGift(f,'385000000');
  trade(f,{v:2,side:'buy',amount:'100000000',quantity:'300000000',block:140});
  trade(f,{v:2,side:'sell',amount:'94000000',quantity:'235000000'});
  f.contracts.get(addr(41)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===2?80000000:0;
  const result=await run(f);assert.equal(alice(result).cashUnits,'399000000');assert.equal(alice(result).actualCashUnits,'764000000');
  const p=result.scores.accountingPositions.find(p=>p.pool===addr(41));assert.equal(p.sharesUnits,'160000000');
  assert.equal(result.scores.actualPositions.find(p=>p.pool===addr(41)).costBasisUnits,'80000000');
  const large=fixture();cashGift(large,'1000000000');
  trade(large,{side:'buy',amount:'1000000000',quantity:'1000000000'});
  large.contracts.get(addr(40)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===0?'1050000000':0;
  const overspend=await run(large);assert.equal(alice(overspend).cashUnits,'107021660');
  assert.equal(overspend.scores.accountingPositions[0].sharesUnits,'367978339');
});

test('cancellation claims reconcile unchanged contract basis and diluted eligible refunds',async()=>{
  const f=fixture();shareGift(f,{});cancel(f);
  const before=await run(f);assert.equal(alice(before).openValueUnits,'81666610');
  refund(f,{quantity:'90000000',amount:'25000000'});
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===0?25000000:0;
  const partial=await run(f);assert.equal(alice(partial).cashUnits,'397500000');
  assert.equal(alice(partial).equityUnits,alice(before).equityUnits);
  refund(f,{quantity:'90000000',amount:'25000000',block:150});
  f.contracts.get(addr(40)).state.costBasis=()=>0;
  const full=await run(f);assert.equal(alice(full).cashUnits,'410000000');
  assert.equal(alice(full).actualCashUnits,'435000000');assert.equal(alice(full).equityUnits,alice(before).equityUnits);
});

test('transferred-away shares leave actual basis but cannot create phantom cancellation equity',async()=>{
  const f=fixture();shareGift(f,{from:addr(30),to:addr(99)});cancel(f);
  const empty=await run(f);assert.equal(alice(empty).openValueUnits,'56666610');
  assert.equal(empty.scores.actualPositions[0].costBasisUnits,'50000000');
  shareGift(f,{block:135});refund(f,{quantity:'90000000',amount:'50000000'});f.contracts.get(addr(40)).state.costBasis=()=>0;
  const returned=await run(f);assert.equal(alice(returned).equityUnits,alice(empty).equityUnits);
  assert.equal(alice(returned).excludedCashUnits,'50000000');
});

test('batch transfers preserve duplicate IDs, zero amounts and self transfers without double counting',async()=>{
  const f=fixture();
  f.addReceipt(hash(60000),125,[f.encoded(f.sharesAbi,'TransferBatch',[addr(30),addr(30),addr(99),[0,0,1],['10000000','20000000','0']],addr(4))]);
  f.addReceipt(hash(60001),126,[f.shareLog(1,addr(30),addr(30),0,'60000000'),f.cashLog(addr(30),addr(30),'385000000',1)]);
  const result=await run(f);assert.equal(result.scores.accountingPositions[0].sharesUnits,'60000000');
  assert.equal(result.scores.actualPositions[0].sharesUnits,'60000000');assert.equal(alice(result).cashUnits,'385000000');
});

test('gifts in a trade receipt stay external; interleaved user movements require review',async()=>{
  const f=fixture();
  const logs=trade(f,{side:'buy',amount:'100000000',quantity:'200000000'});
  logs.push({...f.cashLog(addr(91),addr(30),'100000000',3),blockNumber:150,blockHash:hash(150),transactionHash:hash(30150),removed:false});
  f.logs.push(logs.at(-1));
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===0?150000000:0;
  const result=await run(f);assert.equal(alice(result).cashUnits,'285000000');assert.equal(alice(result).excludedCashUnits,'100000000');
  const interleaved=fixture(),rows=trade(interleaved,{side:'buy',amount:'100000000',quantity:'200000000'});
  rows[1].logIndex=2;rows[2].logIndex=3;
  const gift={...interleaved.cashLog(addr(91),addr(30),'100000000',1),blockNumber:150,blockHash:hash(150),transactionHash:hash(30150),removed:false};
  rows.push(gift);interleaved.logs.push(gift);
  await assert.rejects(run(interleaved),/interleaved_user_transfers_require_review/);
});

test('missing/forged asset legs and hidden transfers fail balance or receipt verification',async()=>{
  for(const kind of ['cash','share','basis']) {
    const f=fixture();
    if(kind==='cash')f.contracts.get(addr(1)).state.balanceOf=()=>1;
    if(kind==='share')f.contracts.get(addr(4)).state.balanceOf=()=>1;
    if(kind==='basis')f.contracts.get(addr(40)).state.costBasis=()=>1;
    await assert.rejects(run(f),/collateral_balance_mismatch|share_balance_mismatch|cost_basis_mismatch/);
  }
  for(const gift of [f=>cashGift(f),f=>shareGift(f,{outcome:1})]) {
    const f=fixture(),hidden=gift(f)[0],original=f.options.provider.getLogs;
    f.options.provider.getLogs=async q=>(await original(q)).filter(l=>l!==hidden);
    await assert.rejects(run(f),/collateral_balance_mismatch|share_balance_mismatch/);
  }
  const missing=fixture(),get=missing.options.provider.getLogs;
  missing.options.provider.getLogs=async q=>(await get(q)).filter(l=>!(l.transactionHash===hash(601)&&l.address===addr(1)));
  await assert.rejects(run(missing),/incomplete_receipt_transfer_coverage/);
  const forged=fixture(),gift=cashGift(forged)[0],fetch=forged.options.provider.getLogs;
  forged.options.provider.getLogs=async q=>(await fetch(q)).map(l=>l===gift?{...l,...forged.cashLog(addr(91),addr(30),'999999999')}:l);
  await assert.rejects(run(forged),/log_receipt_mismatch/);
});

test('pre-start transfers after funding count; grants are not duplicated by replayed RPC logs',async()=>{
  const f=fixture();cashGift(f,'100000000',92,addr(30),addr(99));
  const original=f.options.provider.getLogs;f.options.provider.getLogs=async q=>{const logs=await original(q);return [...logs,...logs];};
  const result=await run(f);assert.equal(alice(result).cashUnits,'285000000');
  assert.equal(result.scores.transferReconciliation.externalMovements.length,1);
  assert.equal(result.snapshot.assetLedger.grants.length,1);
});

test('integer rounding cannot turn outside cash/shares into eligible value',async()=>{
  const f=fixture(),input=(await run(f)).snapshot;
  // Use a synthetic but canonical-unit micro ledger to exercise rounding well
  // below one MXNP. No RPC fixtures or floating-point rounding are involved.
  input.events=[];input.markets=input.markets.slice(0,1);input.assetLedger.movements=input.assetLedger.movements.filter(m=>m.kind==='cash'&&m.blockNumber===90);
  const m=(n,from,to,amount,extra={})=>({kind:'cash',token:addr(1),from,to,units:amount,blockNumber:n,blockHash:hash(n),txHash:hash(70000+n),logIndex:0,itemIndex:0,...extra});
  input.assetLedger.movements.push(m(101,addr(30),addr(99),'499999999'),m(102,addr(91),addr(30),'1'));
  for(let i=0;i<2;i++)input.assetLedger.movements.push(m(103+i,addr(30),addr(99),'1'));
  const score=buildTournamentShadowScores(input);
  assert.equal(score.rows[0].cashUnits,'0');assert.equal(score.rows[0].actualCashUnits,'0');
  const bad=structuredClone(input);bad.assetLedger.movements.at(-1).units='2';
  assert.throws(()=>buildTournamentShadowScores(bad),/exceeds_actual_cash/);
});

test('fully eligible tiny partial refunds preserve the contracts sequential floor rounding',async()=>{
  const input=(await run(fixture())).snapshot;
  input.markets=input.markets.slice(0,1);input.markets[0].status='canceled';
  input.assetLedger.movements=input.assetLedger.movements.filter(m=>m.kind==='cash'&&m.blockNumber===90);
  const metadata=(block,logIndex)=>({blockNumber:block,blockHash:hash(block),txHash:hash(80000+block),logIndex,itemIndex:0});
  const cash=(block,logIndex,from,to,units)=>({kind:'cash',token:addr(1),from,to,units,...metadata(block,logIndex)});
  const share=(block,from,to,units,logIndex=0)=>({kind:'share',token:addr(4),pool:addr(40),outcomeIndex:0,operator:addr(40),from,to,units,...metadata(block,logIndex)});
  const event=(block,logIndex,side,sharesUnits,collateralUnits,burns)=>({chainId:421614,pool:addr(40),wallet:addr(30),
    ...metadata(block,logIndex),timestamp:new Date(Date.parse('2026-11-01T00:00:00Z')+(block-100)*1000).toISOString(),
    side,outcomeIndex:side==='refund'?null:0,sharesUnits,collateralUnits,...(burns?{burns}:{} )});
  input.assetLedger.movements.push(cash(110,0,addr(30),addr(40),'2'),share(110,addr(40),addr(30),'4',1));
  input.events=[event(110,2,'buy','4','2')];
  for(const block of [120,121]) {
    input.assetLedger.movements.push(share(block,addr(30),ZERO,'1'));
    input.events.push(event(block,1,'refund','1','0',[{outcomeIndex:0,sharesUnits:'1'}]));
  }
  const partial=buildTournamentShadowScores(input);
  assert.equal(partial.rows[0].equityUnits,'500000000');assert.equal(partial.actualPositions[0].costBasisUnits,'2');
  assert.equal(partial.accountingPositions[0].costBasisUnits,'2');
  const batched=structuredClone(input),second=batched.assetLedger.movements.find(m=>m.blockNumber===121);
  Object.assign(second,metadata(120,0),{itemIndex:1});
  batched.events=batched.events.filter(e=>e.blockNumber!==121);
  Object.assign(batched.events[1],{sharesUnits:'2',burns:[{outcomeIndex:0,sharesUnits:'1'},{outcomeIndex:0,sharesUnits:'1'}]});
  assert.equal(buildTournamentShadowScores(batched).rows[0].equityUnits,'500000000');
  input.assetLedger.movements.push(share(130,addr(30),ZERO,'2'),cash(130,1,addr(40),addr(30),'2'));
  input.events.push(event(130,2,'refund','2','2',[{outcomeIndex:0,sharesUnits:'2'}]));
  assert.equal(buildTournamentShadowScores(input).rows[0].cashUnits,'500000000');
});

test('two same-pool actions in one receipt consume their own exact legs once',async()=>{
  const f=fixture(),tx=hash(30150),first=trade(f,{side:'buy',amount:'100000000',quantity:'200000000',tx});
  const second=trade(f,{side:'sell',amount:'50000000',quantity:'100000000',tx,offset:3});
  f.receipts.get(tx).logs=[...first,...second];
  // 290m shares and 150m basis after purchase; the 100m sale reduces basis by
  // floor(150m * 100m / 290m), matching the actual pool's holder balance.
  f.contracts.get(addr(40)).state.costBasis=([wallet,index])=>wallet.toLowerCase()===addr(30)&&Number(index)===0?'98275863':0;
  const result=await run(f);assert.equal(result.scores.acceptedEvents,5);
  assert.equal(alice(result).cashUnits,'335000000');assert.equal(result.scores.actualPositions[0].sharesUnits,'190000000');
});

test('malformed grants, asset identities, unknown share IDs and event conflicts refuse',async()=>{
  for(const mutate of [a=>a.assetLedger.grants=[],a=>a.assetLedger.grants.push(a.assetLedger.grants[0]),
    a=>a.assetLedger.movements[0].units='1',a=>a.assetLedger.movements[0].token=addr(99),
    a=>a.assetLedger.movements[0].blockHash=hash(999),a=>a.assetLedger.movements[0].blockNumber=201,
    a=>a.assetLedger.movements.push({...a.assetLedger.movements[0],units:'1'}),
    a=>a.assetLedger.movements[1].logIndex=a.events[0].logIndex]) {
    const input=(await run(fixture())).snapshot;mutate(input);assert.throws(()=>buildTournamentShadowScores(input));
  }
  const f=fixture();shareGift(f,{outcome:100});await assert.rejects(run(f),/transfer_outside_cycle/);
});
