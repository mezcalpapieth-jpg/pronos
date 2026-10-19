import { neon } from '@neondatabase/serverless';
import { planHash,validateTournamentPlan } from './sepolia-tournament.js';
import { sepoliaSeasonRules } from './sepolia-tournament-final.js';
import { seasonSettings,validateSeasonClosure,publicSeasonRows } from './sepolia-tournament-season.js';
import { tournamentProvisionalStore } from './sepolia-tournament-provisional-store.js';
import { validateProvisionalResult } from './sepolia-tournament-provisional.js';
import { tournamentRewardStore } from './sepolia-tournament-reward-store.js';
import { buildRewardEligibility,publicRewardEligibility } from './sepolia-tournament-rewards.js';

export const seasonIdValid=id=>typeof id==='string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(id);
const rowsOf=result=>Array.isArray(result)?result:result.rows;
const unavailable=()=>Object.assign(Error('tournament_results_unavailable'),{status:503});
export async function readRewardEligibility({env=process.env,result,username,sqlFor=neon}={}) {
  if(!seasonSettings(env).enabled || env.ONCHAIN_TOURNAMENT_REWARDS_ENABLED!=='true' || !username)return null;
  if(!result.rows.some(row=>row.username.toLowerCase()===username.toLowerCase()))return null;
  const sql=previewSql(env,sqlFor),report=await tournamentRewardStore(sql).read(result.cycleId);
  if(report) {
    const [cycle]=rowsOf(await sql`SELECT plan,plan_hash,status FROM sepolia_tournament_cycles WHERE cycle_id=${result.cycleId}`);
    if(!cycle || cycle.status!=='funded' || planHash(cycle.plan)!==cycle.plan_hash)throw unavailable();
    const rebuilt=buildRewardEligibility({cycle,result,evidence:report.evidence,review:report.review,
      reviewedResultHash:result.resultHash,reviewedEvidenceHash:report.evidenceHash,reviewedReviewHash:report.reviewHash});
    if(rebuilt.eligibilityHash!==report.eligibilityHash)throw unavailable();
  }
  return publicRewardEligibility(report,result,username);
}
function previewSql(env,sqlFor) {
  const settings=seasonSettings(env);
  if (!settings.enabled) return null;
  if (!settings.configured) throw unavailable();
  return sqlFor(env.DATABASE_URL);
}

// An archive is bound to its own reviewed plan, rather than the next season's
// token/router. Reading it never switches the current runtime or funds anyone.
export async function readArchivedSeason({cycleId,env=process.env,sqlFor=neon}={}) {
  if (seasonSettings(env).enabled && !seasonIdValid(cycleId)) throw Object.assign(Error('invalid_cycle_id'),{status:400});
  const sql=previewSql(env,sqlFor);
  if (!sql) return null;
  const [row]=rowsOf(await sql`SELECT c.plan,c.plan_hash,c.status,r.result
    FROM sepolia_tournament_closures r JOIN sepolia_tournament_cycles c USING(cycle_id)
    WHERE r.cycle_id=${cycleId}`);
  if (!row) return null;
  validateTournamentPlan(row.plan);
  if (row.status!=='funded' || row.plan.cycleId!==cycleId || planHash(row.plan)!==row.plan_hash) throw unavailable();
  return validateSeasonClosure(row,row.result);
}

// Read only public metadata for the most recent 20 closures. Full rows and their
// integrity hash are loaded/validated only when an archive is selected.
export async function readSeasonHistory({env=process.env,sqlFor=neon}={}) {
  const sql=previewSql(env,sqlFor);
  if (!sql) return {seasons:[],hasMore:false};
  const rows=rowsOf(await sql`SELECT r.cycle_id,r.result_hash,
      r.result->>'label' AS label,r.result->>'totalParticipants' AS total_participants,
      c.plan->>'endsAt' AS cutoff_at
    FROM sepolia_tournament_closures r JOIN sepolia_tournament_cycles c USING(cycle_id)
    WHERE c.status='funded' AND c.plan_hash=r.plan_hash
      AND r.result->>'resultHash'=r.result_hash AND r.result->>'cycleId'=c.cycle_id
      AND r.result->>'planHash'=c.plan_hash AND r.result->>'status'='closed'
      AND r.result->>'readyForRewards'='false' AND r.result->>'chainId'='421614'
      AND r.result->>'token'=c.plan->'deployment'->>'token'
      AND r.result->'window'->>'rankingCutoffAt'=c.plan->>'endsAt'
    ORDER BY (c.plan->>'endsAt')::timestamptz DESC,c.cycle_id DESC LIMIT 21`);
  return {seasons:rows.slice(0,20).map(r=>({cycleId:r.cycle_id,label:r.label,cutoffAt:r.cutoff_at,
    totalParticipants:Number(r.total_participants),resultHash:r.result_hash,frozen:true,readyForRewards:false})),hasMore:rows.length>20};
}

export function publicSeasonSummary(season,now=new Date()) {
  const {plan}=season.cycle,timestamp=new Date(now).getTime();
  if (!Number.isFinite(timestamp)) throw unavailable();
  const status=season.closure?'closed':timestamp<Date.parse(plan.startsAt)?'scheduled'
    :timestamp<Date.parse(plan.endsAt)?'active':'awaiting_close';
  return {cycleId:plan.cycleId,label:plan.label,startsAt:plan.startsAt,cutoffAt:plan.endsAt,status,
    frozen:Boolean(season.closure),readyForRewards:false,rules:sepoliaSeasonRules(plan.allocationUnits)};
}

export const PROVISIONAL_STALE_AFTER_MS=15*60*1000;
export async function readProvisionalStandings({season,env=process.env,sqlFor=neon}={}) {
  const sql=previewSql(env,sqlFor);
  if (!sql) return null;
  const result=await tournamentProvisionalStore(sql).read(season.cycle.plan.cycleId);
  return result?validateProvisionalResult(season.cycle,result):null;
}
export function publicProvisionalStandings(result,season,username,now=new Date()) {
  const summary=publicSeasonSummary(season,now);
  const common={...summary,status:'pending',seasonStatus:summary.status,frozen:false};
  if (!result) return {...common,asOf:null,top:[],me:null,totalParticipants:null};
  const age=new Date(now).getTime()-Date.parse(result.asOf.timestamp);
  if (!Number.isFinite(age) || age<0) throw unavailable();
  return {...common,status:'provisional',resultHash:result.resultHash,asOf:result.asOf.timestamp,
    freshness:age>PROVISIONAL_STALE_AFTER_MS?'stale':'fresh',...publicSeasonRows(result,username)};
}
