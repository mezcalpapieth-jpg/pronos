import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers} from 'ethers';
import {reviewFixture} from './sepolia-tournament-review-test-fixture.js';
import {addr,hash} from './sepolia-tournament-test-fixture.js';
import {planHash} from './sepolia-tournament.js';
import {JOIN_ABI} from './sepolia-tournament-join.js';
import {captureTournamentSnapshot} from './sepolia-tournament-capture.js';
import {exportSeasonContext,buildTournamentFinalScores} from './sepolia-tournament-final.js';
import {tournamentCloseStore} from './sepolia-tournament-close-store.js';
import {exportRewardEvidence,buildRewardEligibility} from './sepolia-tournament-rewards.js';
import {tournamentRewardStore} from './sepolia-tournament-reward-store.js';
import {publicSeasonResult} from './sepolia-tournament-season.js';

test('local season: late grant, outside funds, refund, corrected winner, redemption, resumable capture, frozen scoring and eligibility',async()=>{
  const f=await reviewFixture({planOptions:{endsAt:'2020-12-01T06:00:00Z',lateJoinReserveMxnp:'500',maxTotalMxnp:'2000'}});
  try {
    const p=f.plan,bob=addr(31),alice=addr(30),v1=addr(40),v2=addr(41),zero=ethers.constants.AddressZero;
    const start=Date.parse(p.startsAt)/1000,end=Date.parse(p.endsAt)/1000;
    f.options.provider.getBlock=async n=>({number:n,hash:hash(n),timestamp:n>=200?end-1+n-200:start+n-100});
    f.options.provider.getBlockNumber=async()=>202;f.input.final=true;
    const grant={planHash:planHash(p),username:'bob',wallet:bob,suborg:'bob',txHash:hash(750)};
    f.input.lateJoins=[grant];
    f.addReceipt(grant.txHash,115,[f.cashLog(p.deployment.operations,bob,p.allocationUnits)]);
    const join=new ethers.utils.Interface(JOIN_ABI);
    f.transactions.set(grant.txHash,{hash:grant.txHash,blockNumber:115,blockHash:hash(115),chainId:421614,
      from:p.deployment.operations,to:p.deployment.token,value:0,data:join.encodeFunctionData('transfer',[bob,p.allocationUnits])});
    await f.sql`INSERT INTO points_users VALUES('bob',${bob},'bob',NULL,'2020-10-01')`;
    await f.sql`INSERT INTO sepolia_tournament_joins(tx_hash,cycle_id,plan_hash,username,wallet_address,suborg_id,funder_address,nonce,amount_units,signed_tx,status)
      VALUES(${grant.txHash},${p.cycleId},${planHash(p)},'bob',${bob},'bob',${p.deployment.operations},2,${p.allocationUnits},'fixture-only','confirmed')`;
    // The outside gift dilutes the eligible part of Bob's later buy.
    f.addReceipt(hash(751),118,[f.cashLog(p.deployment.operations,bob,'20000000')]);
    f.addReceipt(hash(752),125,[f.cashLog(bob,v2,'40000000'),f.shareLog(2,v2,bob,2,'50000000',1),
      f.encoded(f.eventAbis[2],'SharesBought',[bob,2,'40000000','1000000','50000000'],v2,2)]);
    f.contracts.get(v1).state.canceled=true;f.contracts.get(v1).state.costBasis=()=>0;
    f.addReceipt(hash(760),130,[f.encoded(f.eventAbis[1],'MarketCanceled',[0],v1)]);
    f.addReceipt(hash(761),140,[f.shareLog(1,alice,zero,0,'90000000'),f.cashLog(v1,alice,'50000000',1),
      f.encoded(f.eventAbis[1],'CancelRefunded',[alice,'50000000'],v1,2)]);
    f.contracts.get(v2).state.resolved=true;f.contracts.get(v2).state.outcome=2;f.contracts.get(v2).state.costBasis=([wallet,index])=>Number(index)===2?(wallet.toLowerCase()===alice?60000000:wallet.toLowerCase()===bob?40000000:0):0;
    f.addReceipt(hash(770),131,[f.encoded(f.eventAbis[2],'MarketResolved',[0,0],v2)]);
    f.addReceipt(hash(771),135,[f.encoded(f.eventAbis[2],'ResolutionDisputeOpened',[0,0],v2)]);
    f.addReceipt(hash(772),136,[f.encoded(f.eventAbis[2],'MarketResolutionCorrected',[0,0,2],v2,0),f.encoded(f.eventAbis[2],'MarketResolved',[0,2],v2,1)]);
    for(const [user,shares,n] of [[alice,'170000000',141],[bob,'50000000',145]]) {
      f.addReceipt(hash(800+n),n,[f.shareLog(2,user,zero,2,shares),f.cashLog(v2,user,shares,1),
        f.encoded(f.eventAbis[2],'WinningsRedeemed',[user,2,shares,shares],v2,2)]);
    }
    const saved=new Map(),checkpointStore={read:async k=>saved.get(k)||null,create:async(k,v)=>{assert.equal(saved.has(k),false);saved.set(k,structuredClone(v));}};
    let capture,pauses=0;
    for(let i=0;i<100;i++) {
      capture=await captureTournamentSnapshot(f.input,{...f.options,checkpointStore,maxRequests:5});
      if(capture.status==='complete')break;assert.equal(capture.status,'paused');pauses++;
    }
    assert.equal(capture.status,'complete');assert.ok(pauses>1);
    const artifact=capture.artifact,context=await exportSeasonContext(artifact,f.sql);
    const result=buildTournamentFinalScores({artifact,context,reviewedSnapshotHash:artifact.snapshotHash,reviewedContextHash:planHash(context),now:'2021-01-01'});
    assert.equal(result.totalParticipants,2);assert.equal(result.readyForRewards,false);
    const aliceScore=result.rows.find(r=>r.username==='alice'),bobScore=result.rows.find(r=>r.username==='bob');
    assert.equal(aliceScore.currentPositionValue,0);assert.equal(aliceScore.marketPnl,105);assert.ok(bobScore.marketPnl>0&&bobScore.marketPnl<10);
    assert.equal(artifact.scores.transferReconciliation.historicalBalancesVerified,true);
    const close=tournamentCloseStore(f.sql);await close.close(result);assert.deepEqual(await close.close(result),result);
    await assert.rejects(f.db.exec("UPDATE sepolia_tournament_closures SET result='{}'"),/immutable/);
    const evidence=await exportRewardEvidence(f.input.cycle,result,f.sql),review={version:1,cycleId:p.cycleId,resultHash:result.resultHash,
      evidenceHash:planHash(evidence),reviewedBy:'local_rehearsal',reviewedAt:'2021-01-01T00:00:00Z',supersedes:null,
      decisions:result.rows.map(r=>({username:r.username,decision:'approve'}))};
    const eligibility=buildRewardEligibility({cycle:f.input.cycle,result,evidence,review,reviewedResultHash:result.resultHash,
      reviewedEvidenceHash:planHash(evidence),reviewedReviewHash:planHash(review)});
    await tournamentRewardStore(f.sql).publish(eligibility);assert.equal(eligibility.readyForRewards,false);
    assert.ok(eligibility.rows.every(r=>r.status==='not_qualified')); // Two markets do not meet Points qualification.
    assert.doesNotMatch(JSON.stringify(publicSeasonResult(result,'bob')),/registeredWallet|suborg|signed_tx/);
    assert.equal((await f.db.query('SELECT balance FROM points_balances')).rows[0].balance,'12345');
    assert.equal((await f.db.query('SELECT plan_hash FROM sepolia_tournament_cycles')).rows[0].plan_hash,planHash(p));
  }finally{await f.db.close();}
});
