import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,stat,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewFixture } from './sepolia-tournament-review-test-fixture.js';
import { planHash } from './sepolia-tournament.js';
import { addr } from './sepolia-tournament-test-fixture.js';
import { buildRewardEligibility,exportRewardEvidence,publicRewardEligibility } from './sepolia-tournament-rewards.js';
import { tournamentRewardStore } from './sepolia-tournament-reward-store.js';
import { readRewardEligibility } from './sepolia-tournament-presentation.js';
import { createTournamentResultsHandler } from '../points/tournament-results.js';
import { rewardsCommand } from '../scripts/onchain-sepolia-rewards.mjs';

const reviewFor=(result,evidence,changes={})=>({version:1,cycleId:result.cycleId,resultHash:result.resultHash,
  evidenceHash:planHash(evidence),reviewedBy:'reviewer',reviewedAt:'2026-10-19T00:00:00Z',supersedes:null,
  decisions:result.rows.map(r=>({username:r.username,decision:'approve'})),...changes});
const argsFor=(f,evidence,review=reviewFor(f.result,evidence))=>({cycle:f.input.cycle,result:f.result,evidence,review,
  reviewedResultHash:f.result.resultHash,reviewedEvidenceHash:planHash(evidence),reviewedReviewHash:planHash(review)});
const envFor=f=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'onchain-sepolia',ONCHAIN_PREVIEW_APPROVALS_ENABLED:'true',
  ONCHAIN_CHAIN_ID:'421614',ONCHAIN_TOURNAMENT_SEASON_ENABLED:'true',ONCHAIN_TOURNAMENT_REWARDS_ENABLED:'true',
  ONCHAIN_TOURNAMENT_CYCLE_ID:f.plan.cycleId,ONCHAIN_RPC_URL:'https://rpc.invalid',
  DATABASE_URL:'postgres://local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb'});
test('eligibility filters frozen ranking, requires qualification and explicit decisions, and never approves payment',async()=>{
  const f=await reviewFixture({final:true});
  try {
    const evidence=await exportRewardEvidence(f.input.cycle,f.result,f.sql);
    const result=structuredClone(f.result);
    result.rows=Array.from({length:4},(_,i)=>({...result.rows[0],username:`player${i}`,rank:i+1,qualified:i!==3}));
    result.totalParticipants=4;const {resultHash,...body}=result;result.resultHash=planHash(body);
    const synthetic={...f,result};evidence.resultHash=result.resultHash;
    evidence.accounts=result.rows.map((r,i)=>({...evidence.accounts[0],username:r.username,registeredWallet:addr(30+i),wallet:addr(30+i),registeredSuborg:r.username,suborg:r.username}));
    const review=reviewFor(result,evidence,{decisions:[{username:'player0',decision:'exclude',reason:'Reviewed duplicate account'},
      {username:'player1',decision:'approve'},{username:'player2',decision:'hold',reason:'Identity review'},
      {username:'player3',decision:'approve'}]});
    const report=buildRewardEligibility(argsFor(synthetic,evidence,review));
    assert.deepEqual(report.rows.map(r=>r.status),['ineligible','eligible','on_hold','not_qualified']);
    assert.deepEqual(report.rows.map(r=>r.frozenRank),[1,2,3,4]);assert.equal(report.rows[1].eligibilityRank,1);
    assert.equal(report.readyForRewards,false);assert.equal(report.amount,undefined);assert.equal(report.currency,undefined);
    assert.equal(result.rows[1].rank,2);assert.equal(result.rows[1].score,f.result.rows[0].score);
    assert.equal(publicRewardEligibility(report,result,'PLAYER1').status,'eligible');
    assert.equal(publicRewardEligibility(report,result,null),null);assert.equal(publicRewardEligibility(report,result,'stranger'),null);
    assert.doesNotMatch(JSON.stringify(publicRewardEligibility(report,result,'player0')),/duplicate|reviewer|wallet|suborg|0x/);
    assert.equal(publicRewardEligibility(null,result,'player1').status,'pending_review');
  } finally {await f.db.close();}
});
test('unreviewed accounts, incomplete decisions, changed hashes and blocked/mismatched identities fail closed',async()=>{
  const f=await reviewFixture({final:true});
  try {
    const evidence=await exportRewardEvidence(f.input.cycle,f.result,f.sql),args=argsFor(f,evidence);
    for(const mutate of [a=>a.reviewedResultHash='bad',a=>a.reviewedEvidenceHash='bad',a=>a.reviewedReviewHash='bad',
      a=>a.review.decisions=[],a=>a.review.decisions.push(a.review.decisions[0]),a=>a.review.reviewedAt='2099-01-01',
      a=>a.review.reviewedAt='2020-01-01',a=>a.result.status='provisional',a=>a.evidence.accounts=[],
      a=>a.review.decisions[0]={username:'alice',decision:'hold',reason:''}]) {
      const bad=structuredClone(args);mutate(bad);assert.throws(()=>buildRewardEligibility(bad));
    }
    for(const change of [{reviewStatus:'watch'},{reviewStatus:'under_review'},{reviewStatus:'ineligible'},
      {reviewStatus:'phone_required'},{reviewStatus:'unknown'},{apiBlocked:true},{wallet:addr(99)},{suborg:'other'},{wallet:null}]) {
      const changed=structuredClone(evidence);Object.assign(changed.accounts[0],change);
      assert.throws(()=>buildRewardEligibility(argsFor(f,changed)),/hold_requires_resolution|invalid_reward_decision/);
      if(change.reviewStatus!=='unknown') {
        const held=reviewFor(f.result,changed,{decisions:[{username:'alice',decision:'hold',reason:'Pending account review'}]});
        assert.equal(buildRewardEligibility(argsFor(f,changed,held)).readyForRewards,false);
      }
    }
  } finally {await f.db.close();}
});
test('eligibility publication is immutable, idempotent, superseded explicitly and rejects stale account evidence',async()=>{
  const f=await reviewFixture({final:true});
  try {
    const store=tournamentRewardStore(f.sql),evidence=await exportRewardEvidence(f.input.cycle,f.result,f.sql);
    const first=buildRewardEligibility(argsFor(f,evidence));
    await store.publish(first);assert.deepEqual(await store.publish(first),first);
    const held=reviewFor(f.result,evidence,{decisions:[{username:'alice',decision:'hold',reason:'Recheck identity'}]});
    await assert.rejects(store.publish(buildRewardEligibility(argsFor(f,evidence,held))),/superseded/);
    held.supersedes=first.eligibilityHash;
    const second=buildRewardEligibility(argsFor(f,evidence,held));await store.publish(second);
    assert.equal((await store.read(f.plan.cycleId)).eligibilityHash,second.eligibilityHash);
    await assert.rejects(f.db.exec("UPDATE sepolia_tournament_eligibility SET report='{}'"),/immutable/);
    await assert.rejects(f.db.exec('DELETE FROM sepolia_tournament_eligibility'),/immutable/);
    const next=reviewFor(f.result,evidence,{supersedes:second.eligibilityHash});
    await f.db.exec("UPDATE points_users SET api_blocked_at=now()");
    await assert.rejects(store.publish(buildRewardEligibility(argsFor(f,evidence,next))),/evidence_changed/);
    assert.equal((await f.db.query('SELECT balance FROM points_balances')).rows[0].balance,'12345');
    assert.deepEqual((await f.db.query('SELECT result FROM sepolia_tournament_closures')).rows[0].result,f.result);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM sepolia_tournament_eligibility')).rows[0].n,2);
  } finally {await f.db.close();}
});
test('preview API exposes only the session participant eligibility and never review reasons or private identities',async()=>{
  const f=await reviewFixture({final:true});
  try {
    const env=envFor(f),evidence=await exportRewardEvidence(f.input.cycle,f.result,f.sql);
    await tournamentRewardStore(f.sql).publish(buildRewardEligibility(argsFor(f,evidence)));
    const readEligibility=options=>readRewardEligibility({...options,sqlFor:()=>f.sql});
    const me=await readEligibility({env,result:f.result,username:'ALICE'});assert.equal(me.status,'not_qualified');
    const run=async username=>{
      const res={setHeader(){},status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
      await createTournamentResultsHandler({env,readArchive:async()=>f.result,readEligibility,sessionFor:()=>({username})})
        ({method:'GET',query:{cycleId:f.plan.cycleId},headers:{}},res);return res;
    };
    const response=await run('alice');assert.equal(response.code,200);assert.deepEqual(response.body.rewardEligibility,me);
    assert.doesNotMatch(JSON.stringify(response.body),/registeredWallet|registeredSuborg|"wallet"|"suborg"|reviewedBy|reviewStatus|0x/);
    assert.equal((await run('stranger')).body.rewardEligibility,null);assert.equal((await run(null)).body.rewardEligibility,null);
    for(const change of [{VERCEL_ENV:'production'},{VERCEL_GIT_COMMIT_REF:'pointbreak'},{ONCHAIN_TOURNAMENT_REWARDS_ENABLED:'false'}]) {
      assert.equal(await readRewardEligibility({env:{...env,...change},result:f.result,username:'alice',sqlFor:()=>assert.fail('no connection')}),null);
    }
  } finally {await f.db.close();}
});
test('review publication refuses an expired lease after evidence reads',async()=>{
  const f=await reviewFixture({final:true});
  try {
    const evidence=await exportRewardEvidence(f.input.cycle,f.result,f.sql),report=buildRewardEligibility(argsFor(f,evidence));
    const sql=async(strings,...values)=>{
      const result=await f.sql(strings,...values);
      if(strings.join('').includes('FROM points_users u LEFT JOIN points_account_reviews')) {
        await f.db.exec("UPDATE sepolia_tournament_lock SET lease_until=now()-interval '1 second'");
      }
      return result;
    };
    await assert.rejects(tournamentRewardStore(sql).publish(report),/lease_lost/);
    assert.equal(await tournamentRewardStore(f.sql).read(f.plan.cycleId),null);
  } finally {await f.db.close();}
});
test('reward CLI defaults to private offline export, guards preview publication and cannot pay',async()=>{
  const f=await reviewFixture({final:true}),dir=await mkdtemp(join(tmpdir(),'pronos-reward-'));
  try {
    const evidence=await exportRewardEvidence(f.input.cycle,f.result,f.sql),review=reviewFor(f.result,evidence),args=argsFor(f,evidence,review);
    const input=join(dir,'frozen.json'),reviewPath=join(dir,'review.json'),evidencePath=join(dir,'evidence.json'),output=join(dir,'report.json');
    await writeFile(input,JSON.stringify({cycle:f.input.cycle,result:f.result}));await writeFile(reviewPath,JSON.stringify(review));await writeFile(evidencePath,JSON.stringify(evidence));
    const values={input,review:reviewPath,evidence:evidencePath,output,'reviewed-result-hash':args.reviewedResultHash,
      'reviewed-evidence-hash':args.reviewedEvidenceHash,'reviewed-review-hash':args.reviewedReviewHash};
    assert.equal((await rewardsCommand(values,{sqlFor:()=>assert.fail('offline')})).published,false);
    assert.equal((await stat(output)).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(output)).readyForRewards,false);
    await assert.rejects(rewardsCommand(values),/EEXIST/);
    await assert.rejects(rewardsCommand({...values,apply:true},{env:{...envFor(f),VERCEL_ENV:'production'},branch:()=> 'onchain-sepolia',sqlFor:()=>assert.fail('guarded')}),/preview_destination/);
    const env=envFor(f),summary=await rewardsCommand({...values,output:join(dir,'published.json'),apply:true,
      'expected-host':new URL(env.DATABASE_URL).hostname},{env,branch:()=> 'onchain-sepolia',sqlFor:()=>f.sql});
    assert.equal(summary.published,true);assert.equal(summary.readyForRewards,false);
    await rewardsCommand({'export-evidence':true,'cycle-id':f.plan.cycleId,output:join(dir,'export.json'),
      'expected-host':new URL(env.DATABASE_URL).hostname},{env,branch:()=> 'onchain-sepolia',sqlFor:()=>f.sql});
    assert.deepEqual(JSON.parse(await readFile(join(dir,'export.json'))),evidence);
  } finally {await f.db.close();await rm(dir,{recursive:true,force:true});}
});
