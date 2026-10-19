import { address,planHash,seasonLateJoinsHash,validateTournamentPlan } from './sepolia-tournament.js';
import { validateSeasonClosure } from './sepolia-tournament-season.js';

const rows=r=>Array.isArray(r)?r:r.rows;
const fail=code=>{throw Error(code);};
const hashValid=h=>/^[a-f0-9]{64}$/.test(h||'');
const reviewStatuses=['clear','watch','phone_required','under_review','ineligible'];

// Read-only evidence: no email, phone, IP, risk narratives or credentials. The
// original registration remains authoritative if an account changes wallets.
export async function exportRewardEvidence(cycle,result,sql) {
  validateSeasonClosure(cycle,result);
  const joins=rows(await sql`SELECT tx_hash,username,wallet_address,suborg_id,amount_units::text,plan_hash,status
    FROM sepolia_tournament_joins WHERE cycle_id=${result.cycleId} AND status<>'reverted'`);
  if(joins.some(r=>r.status!=='confirmed') || seasonLateJoinsHash(joins.map(r=>({txHash:r.tx_hash,username:r.username,
    wallet:r.wallet_address,suborg:r.suborg_id,openingUnits:r.amount_units,planHash:r.plan_hash})))!==result.lateJoinsHash)fail('reward_registration_ledger_changed');
  const registrations=[...cycle.plan.batches.flatMap(b=>b.recipients).filter(r=>r.kind==='user'),
    ...joins.map(r=>({username:r.username,wallet:r.wallet_address,suborg:r.suborg_id}))];
  const accounts=rows(await sql`SELECT LOWER(u.username) AS username,u.wallet_address,u.turnkey_sub_org_id,
    u.api_blocked_at,COALESCE(r.status,'clear') AS review_status,r.updated_at AS review_updated_at
    FROM points_users u LEFT JOIN points_account_reviews r ON LOWER(r.username)=LOWER(u.username)
    WHERE LOWER(u.username)=ANY(${result.rows.map(r=>r.username)}::text[])`);
  return {version:1,cycleId:result.cycleId,resultHash:result.resultHash,
    accounts:result.rows.map(row=>{
      const registered=registrations.filter(r=>r.username===row.username),found=accounts.filter(r=>r.username===row.username);
      if(registered.length!==1 || found.length>1)fail('ambiguous_reward_identity');
      const u=found[0];
      return {username:row.username,registeredWallet:registered[0].wallet,registeredSuborg:registered[0].suborg,
        wallet:u?.wallet_address?.toLowerCase()||null,suborg:u?.turnkey_sub_org_id||null,
        reviewStatus:u?u.review_status:'under_review',apiBlocked:Boolean(u?.api_blocked_at),
        reviewUpdatedAt:u?.review_updated_at?new Date(u.review_updated_at).toISOString():null};
    })};
}

// Qualification is taken from frozen Points scoring. Every participant needs
// an explicit decision; unknown/mismatched/blocked accounts cannot be approved.
// Eligible rank filters the frozen order without changing anyone's score/rank.
export function buildRewardEligibility({cycle,result,evidence,review,reviewedResultHash,
  reviewedEvidenceHash,reviewedReviewHash,now=new Date()}) {
  validateTournamentPlan(cycle.plan);
  if(cycle.status!=='funded' || planHash(cycle.plan)!==cycle.plan_hash)fail('reviewed_funded_cycle_required');
  validateSeasonClosure(cycle,result);
  if(result.resultHash!==reviewedResultHash || result.mode!=='final' || result.version!==1)fail('reviewed_frozen_result_required');
  if(evidence?.version!==1 || planHash(evidence)!==reviewedEvidenceHash || evidence.cycleId!==result.cycleId
    || evidence.resultHash!==result.resultHash || !Array.isArray(evidence.accounts))fail('reviewed_reward_evidence_required');
  if(review?.version!==1 || planHash(review)!==reviewedReviewHash || review.cycleId!==result.cycleId
    || review.resultHash!==result.resultHash || review.evidenceHash!==reviewedEvidenceHash
    || typeof review.reviewedBy!=='string' || !/^[a-zA-Z0-9_@.-]{1,80}$/.test(review.reviewedBy)
    || !Number.isFinite(Date.parse(review.reviewedAt)) || Date.parse(review.reviewedAt)<Date.parse(result.window.rankingCutoffAt)
    || Date.parse(review.reviewedAt)>new Date(now).getTime() || !Number.isFinite(new Date(now).getTime())
    || (review.supersedes!==null && !hashValid(review.supersedes)) || !Array.isArray(review.decisions))fail('reviewed_reward_decisions_required');
  const names=result.rows.map(r=>r.username);
  if(new Set(names).size!==names.length || result.rows.some((r,i)=>r.rank!==i+1 || typeof r.qualified!=='boolean')
    || evidence.accounts.length!==names.length || review.decisions.length!==names.length
    || new Set(evidence.accounts.map(r=>r.username)).size!==names.length
    || new Set(review.decisions.map(r=>r.username)).size!==names.length
    || [...evidence.accounts,...review.decisions].some(r=>!names.includes(r.username)))fail('complete_reward_review_required');
  let eligibilityRank=0;
  const resultRows=result.rows.map(row=>{
    const account=evidence.accounts.find(r=>r.username===row.username),decision=review.decisions.find(r=>r.username===row.username);
    if(!reviewStatuses.includes(account.reviewStatus) || typeof account.apiBlocked!=='boolean'
      || !['approve','hold','exclude'].includes(decision.decision)
      || (decision.decision!=='approve' && (typeof decision.reason!=='string' || !decision.reason.trim() || decision.reason.length>1000)))fail('invalid_reward_decision');
    let identityMatches=false;
    try {identityMatches=address(account.registeredWallet)===address(account.wallet)
      && typeof account.registeredSuborg==='string' && Boolean(account.registeredSuborg) && account.registeredSuborg===account.suborg;} catch { /* held */ }
    if(decision.decision==='approve' && (!identityMatches || account.apiBlocked || account.reviewStatus!=='clear'))fail('reward_hold_requires_resolution');
    const status=!row.qualified?'not_qualified':decision.decision==='approve'?'eligible':decision.decision==='exclude'?'ineligible':'on_hold';
    return {username:row.username,frozenRank:row.rank,qualified:row.qualified,status,
      eligibilityRank:status==='eligible'?++eligibilityRank:null,wallet:account.registeredWallet,suborg:account.registeredSuborg};
  });
  const body={version:1,cycleId:result.cycleId,planHash:result.planHash,resultHash:result.resultHash,
    evidenceHash:reviewedEvidenceHash,reviewHash:reviewedReviewHash,supersedes:review.supersedes,
    reviewedAt:review.reviewedAt,reviewedBy:review.reviewedBy,readyForRewards:false,
    policy:'qualified_and_explicitly_approved_in_frozen_order',evidence,review,rows:resultRows};
  return {...body,eligibilityHash:planHash(body)};
}

export function publicRewardEligibility(report,result,username) {
  if(!username)return null;
  const participant=result.rows.find(r=>r.username.toLowerCase()===username.toLowerCase());
  if(!participant)return null;
  const row=report?.rows.find(r=>r.username===participant.username);
  return {status:row?.status||'pending_review',eligibilityRank:row?.eligibilityRank||null,
    reviewedAt:report?.reviewedAt||null,eligibilityHash:report?.eligibilityHash||null,readyForRewards:false};
}
