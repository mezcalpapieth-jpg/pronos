import { neon } from '@neondatabase/serverless';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { isSepoliaGasDatabase } from './sepolia-gas-config.js';
import { tournamentCloseStore } from './sepolia-tournament-close-store.js';
import { planHash, validateTournamentPlan } from './sepolia-tournament.js';

const unavailable = () => Object.assign(Error('tournament_season_unavailable'),{status:503});
export function seasonSettings(env=process.env) {
  const enabled=pendingApprovalSettings(env).previewEnabled && env.ONCHAIN_TOURNAMENT_SEASON_ENABLED==='true';
  return {enabled,configured:Boolean(enabled && isSepoliaGasDatabase(env.DATABASE_URL)
    && /^[a-z0-9][a-z0-9-]{2,63}$/.test(env.ONCHAIN_TOURNAMENT_CYCLE_ID||''))};
}
export function validateSeasonClosure(cycle,closure) {
  const {plan}=cycle;
  const {resultHash,...body}=closure;
  if (resultHash!==planHash(body) || closure.status!=='closed' || closure.readyForRewards!==false
    || closure.cycleId!==plan.cycleId || closure.planHash!==cycle.plan_hash
    || closure.token!==plan.deployment.token || closure.chainId!==421614
    || closure.window?.rankingCutoffAt!==plan.endsAt || !Array.isArray(closure.rows)
    || closure.totalParticipants!==closure.rows.length) throw unavailable();
  return closure;
}
export async function readRuntimeSeason({env=process.env,sqlFor=neon}={}) {
  const settings=seasonSettings(env);
  if (!settings.enabled) return null;
  if (!settings.configured) throw unavailable();
  try {
    const sql=sqlFor(env.DATABASE_URL);
    const rows=await sql`SELECT plan,plan_hash,status FROM sepolia_tournament_cycles WHERE cycle_id=${env.ONCHAIN_TOURNAMENT_CYCLE_ID}`;
    const cycle=(Array.isArray(rows)?rows:rows.rows)?.[0],plan=cycle?.plan;
    if (!plan || cycle.status!=='funded' || plan.cycleId!==env.ONCHAIN_TOURNAMENT_CYCLE_ID) throw unavailable();
    validateTournamentPlan(plan);
    if (planHash(plan)!==cycle.plan_hash) throw unavailable();
    for (const [key,field] of [['ONCHAIN_COLLATERAL_ADDRESS','token'],['ONCHAIN_MARKET_FACTORY_ADDRESS','factoryV1'],
      ['ONCHAIN_MARKET_FACTORY_V2_ADDRESS','factoryV2'],['ONCHAIN_TRADING_ROUTER_ADDRESS','router']]) {
      if (env[key]?.toLowerCase()!==plan.deployment[field]) throw unavailable();
    }
    const closure=await tournamentCloseStore(sql).read(plan.cycleId);
    if (closure) validateSeasonClosure(cycle,closure);
    return {cycle,closure};
  } catch {throw unavailable();}
}

// Applies only to the separately opted-in future season. Keep settlement and
// old-pool claims available; the trading endpoints check this before signing.
export async function assertTournamentTradingOpen({now=new Date(),...dependencies}={}) {
  const season=await readRuntimeSeason(dependencies);
  if (!season) return;
  const {plan}=season.cycle,timestamp=new Date(now).getTime();
  if (!Number.isFinite(timestamp) || timestamp<Date.parse(plan.startsAt)) throw Object.assign(Error('tournament_not_started'),{status:409});
  if (season.closure || timestamp>=Date.parse(plan.endsAt)) throw Object.assign(Error('tournament_closed'),{status:409});
}

export function publicSeasonRows(result,username) {
  // Explicit allowlist: future operator audit fields must not become public.
  const fields=['username','rank','balance','finalBalance','marketPnl','tradingPnl','currentPositionValue',
    'score','cycleDelta','holdBonus','convictionBonus','convictionBonusGross','convictionBonusCapApplied',
    'convictionEligibleProfit','convictionMarkets','convictionLots','activeDays','inactiveDays',
    'inactivityPenalty','qualifyingMarkets','qualified','totalActions','buyCount','liquidityReward',
    'parlayPnl','parlayTickets','parlayWins','stockPnl'];
  const publicRow=row=>Object.fromEntries(fields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
  const top=result.rows.slice(0,20).map(publicRow);
  const me=result.rows.find(r=>r.username.toLowerCase()===String(username||'').toLowerCase());
  return {top,me:me?publicRow(me):null,tournamentTop:top,tournamentMe:me?publicRow(me):null,totalParticipants:result.totalParticipants};
}
export function publicSeasonResult(result,username) {
  return {status:'closed',frozen:true,readyForRewards:false,cycleId:result.cycleId,label:result.label,
    startsAt:result.window.startsAt,cutoffAt:result.window.rankingCutoffAt,resultHash:result.resultHash,rules:result.rules,
    ...publicSeasonRows(result,username)};
}
