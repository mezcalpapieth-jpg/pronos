import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { buildTournamentSnapshot } from './sepolia-tournament-snapshot.js';
import { buildTournamentShadowScores } from './sepolia-tournament-scoring.js';
import { refundBurns } from './sepolia-tournament-lifecycle.js';
import { fixture, addr, hash } from './sepolia-tournament-test-fixture.js';

const shares=new ethers.utils.Interface([
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
]);
const run=f=>buildTournamentSnapshot(f.input,f.options);
function cancel(f,v=1) {
  const pool=addr(39+v),share=addr(3+v),outcome=v===1?0:2,held=v===1?90000000:170000000,basis=v===1?50000000:60000000;
  f.contracts.get(pool).state.canceled=true;
  f.contracts.get(pool).state.costBasis=args=>Number(args[1])===outcome&&args[0].toLowerCase()===addr(30)?basis:0;
  f.contracts.get(share).state.balanceOf=args=>args[1].toNumber()===outcome&&args[0].toLowerCase()===addr(30)?held:0;
  f.addReceipt(hash(700+v),130,[f.encoded(f.eventAbis[v],'MarketCanceled',[0],pool)]);
  return {pool,share,outcome,held,basis};
}
function refund(f,{v=1,amount=90000000,payout=50000000,batch=false,block=140}={}) {
  const pool=addr(39+v),share=addr(3+v),outcome=v===1?0:2;
  const args=batch?[pool,addr(30),ethers.constants.AddressZero,[outcome],[amount]]:[pool,addr(30),ethers.constants.AddressZero,outcome,amount];
  return f.addReceipt(hash(800+v+block),block,[f.encoded(shares,batch?'TransferBatch':'TransferSingle',args,share,0),
    f.encoded(f.eventAbis[v],'CancelRefunded',[addr(30),payout],pool,1)]);
}
test('canceled claims carry remaining purchase basis; partial and full refunds preserve equity exactly',async()=>{
  const f=fixture();cancel(f);const before=await run(f);
  assert.equal(before.scores.rows[0].equityUnits,'491666610');
  refund(f,{amount:45000000,payout:25000000});
  f.contracts.get(addr(40)).state.costBasis=args=>Number(args[1])===0?25000000:0;
  f.contracts.get(addr(4)).state.balanceOf=args=>args[1].toNumber()===0?45000000:0;
  const partial=await run(f);assert.equal(partial.scores.rows[0].equityUnits,before.scores.rows[0].equityUnits);
  assert.equal(partial.scores.rows[0].cashUnits,'410000000');
  refund(f,{amount:45000000,payout:25000000,block:150,batch:true});
  f.contracts.get(addr(40)).state.costBasis=()=>0;f.contracts.get(addr(4)).state.balanceOf=()=>0;
  const full=await run(f);assert.equal(full.scores.rows[0].equityUnits,before.scores.rows[0].equityUnits);
  assert.equal(full.scores.rows[0].cashUnits,'435000000');
});
test('V2 burns use its 256-stride token IDs and a smaller actual payout records the loss',async()=>{
  const f=fixture();cancel(f,2);const before=await run(f);
  refund(f,{v:2,amount:170000000,payout:59000000,batch:true});
  f.contracts.get(addr(41)).state.costBasis=()=>0;f.contracts.get(addr(5)).state.balanceOf=()=>0;
  const after=await run(f);
  assert.equal(BigInt(before.scores.rows[0].equityUnits)-BigInt(after.scores.rows[0].equityUnits),1000000n);
  assert.equal(after.snapshot.events.at(-1).burns[0].outcomeIndex,2);
});
test('nonzero V2 market IDs attribute only that market token range',()=>{
  const market={pool:addr(40),marketId:'2',outcomeCount:3},abi=fixture().eventAbis[2];
  const event=f=>({...f,logIndex:1,address:addr(5)});
  const burn=event(shares.encodeEventLog(shares.getEvent('TransferSingle'),[market.pool,addr(30),ethers.constants.AddressZero,514,100]));
  const log={logIndex:2,parsed:abi.parseLog(fixture().encoded(abi,'CancelRefunded',[addr(30),10],market.pool,2))};
  const args={receipt:{logs:[burn]},log,market,shareToken:addr(5),version:'V2'};
  assert.deepEqual(refundBurns(args),[{outcomeIndex:2,sharesUnits:'100'}]);
  Object.assign(burn,shares.encodeEventLog(shares.getEvent('TransferSingle'),[market.pool,addr(30),ethers.constants.AddressZero,6,100]));
  assert.throws(()=>refundBurns(args),/refund_burn_mismatch/);
});
test('refunds refuse missing, foreign or excessive burns/payouts and external basis/holding changes',async()=>{
  for(const mutate of [
    (f,logs)=>{logs[0].address=addr(99);},
    (f,logs)=>{const event=shares.encodeEventLog(shares.getEvent('TransferSingle'),[addr(40),addr(99),ethers.constants.AddressZero,0,90000000]);Object.assign(logs[0],event);},
    (f)=>{f.contracts.get(addr(40)).state.costBasis=()=>1;},
    (f)=>{f.contracts.get(addr(4)).state.balanceOf=()=>1;},
  ]) {
    const f=fixture();cancel(f);const logs=refund(f);f.contracts.get(addr(40)).state.costBasis=()=>0;f.contracts.get(addr(4)).state.balanceOf=()=>0;
    mutate(f,logs);await assert.rejects(run(f),/refund_burns_missing|cancellation_balance_or_basis_mismatch/);
  }
  const excessive=fixture();cancel(excessive);refund(excessive,{payout:50000001});
  await assert.rejects(run(excessive),/refund_exceeds_cost_basis/);
});
test('refund burn order preserves contract integer rounding for repeated outcomes',async()=>{
  const f=fixture(),artifact=await run(f),input=artifact.snapshot;
  input.markets[0].status='canceled';input.markets=input.markets.slice(0,1);
  const buy={...input.events[0],sharesUnits:'4',collateralUnits:'2'};
  const refundEvent={...buy,side:'refund',blockNumber:120,blockHash:hash(120),txHash:hash(900),logIndex:0,
    sharesUnits:'2',collateralUnits:'0',burns:[{outcomeIndex:0,sharesUnits:'1'},{outcomeIndex:0,sharesUnits:'1'}]};
  input.events=[buy,refundEvent];const score=buildTournamentShadowScores(input);
  assert.equal(score.rows[0].equityUnits,'500000000');assert.equal(score.accountingPositions[0].costBasisUnits,'2');
  input.events[1].collateralUnits='1';assert.throws(()=>buildTournamentShadowScores(input),/refund_exceeds_cost_basis/);
});
test('closed disputes and correction/resolution pairs value the final winner once in both contracts',async()=>{
  for(const v of [1,2]) {
    const f=fixture(),pool=addr(39+v),abi=f.eventAbis[v],old=v===1?1:2,next=v===1?2:1;
    f.contracts.get(pool).state.resolved=true;f.contracts.get(pool).state.outcome=next;
    f.addReceipt(hash(900),130,[f.encoded(abi,'MarketResolved',[0,old],pool)]);
    f.addReceipt(hash(901),140,[f.encoded(abi,'ResolutionDisputeOpened',[0,old],pool)]);
    f.addReceipt(hash(902),150,[f.encoded(abi,'MarketResolutionCorrected',[0,old,next],pool,0),f.encoded(abi,'MarketResolved',[0,next],pool,1)]);
    const result=await run(f);
    assert.equal(result.snapshot.markets.find(m=>m.pool===pool).winner,next-(v===1?1:0));
    assert.equal(result.scores.acceptedEvents,3);
  }
  const cleared=fixture({resolved:true}),abi=cleared.eventAbis[1];
  cleared.addReceipt(hash(903),150,[cleared.encoded(abi,'ResolutionDisputeOpened',[0,1],addr(40),0),cleared.encoded(abi,'ResolutionDisputeCleared',[0,1],addr(40),1)]);
  assert.equal((await run(cleared)).scores.rows[0].equityUnits,'645000000');
});
test('open disputes, missing correction pairs and corrections/cancellations after any payout fail closed',async()=>{
  const open=fixture({resolved:true});open.contracts.get(addr(40)).state.disputed=true;
  open.addReceipt(hash(900),150,[open.encoded(open.eventAbis[1],'ResolutionDisputeOpened',[0,1],addr(40))]);
  await assert.rejects(run(open),/open_dispute/);
  for(const action of ['MarketResolutionCorrected','MarketCanceled']) {
    const f=fixture({resolved:true}),abi=f.eventAbis[1];
    // Even a payout to a wallet outside the tournament forbids a correction.
    const redeemed=f.logs.find(l=>l.transactionHash===hash(631));
    Object.assign(redeemed,abi.encodeEventLog(abi.getEvent('WinningsRedeemed'),[addr(99),90000000,90000000]));
    f.addReceipt(hash(901),150,[f.encoded(abi,'ResolutionDisputeOpened',[0,1],addr(40))]);
    f.addReceipt(hash(902),160,[f.encoded(abi,action,action==='MarketCanceled'?[0]:[0,1,2],addr(40))]);
    await assert.rejects(run(f),/invalid_correction_history|invalid_cancellation_history/);
  }
  const missing=fixture(),abi=missing.eventAbis[1];missing.contracts.get(addr(40)).state.resolved=true;
  for(const [n,name,args] of [[130,'MarketResolved',[0,1]],[140,'ResolutionDisputeOpened',[0,1]],[150,'MarketResolutionCorrected',[0,1,2]]]) {
    missing.addReceipt(hash(n+900),n,[missing.encoded(abi,name,args,addr(40))]);
  }
  await assert.rejects(run(missing),/correction_resolution_pair_missing/);
});
