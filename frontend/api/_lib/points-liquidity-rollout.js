import { randomUUID } from 'node:crypto';
import { LIQUIDITY_TARGETS, marketBuyImpacts, planMarketFunding, recommendMarketFunding } from './market-funding.js';
import { addPointsMarketFunding } from './points-market-funding.js';
import { getTournamentWindow, tournamentScoringStartsAt } from './points-tournament-config.js';

const PROTECTED_MARKET_IDS = [317676];
const POLICY = Object.freeze({ scope: 'current-tournament-trophy', nonSportsFundingFraction: 0.5 });

const impacts = reserves => LIQUIDITY_TARGETS.map(target => ({ ...target,
  worstImpactPts: Math.max(...marketBuyImpacts(reserves, target.collateral).map(row => row.impactPts)),
}));

async function tournamentPools(client, window, marketId = null, lock = false) {
  return client.query(`
    SELECT m.id, m.question, m.reserves, COALESCE(p.category, m.category) AS category
      FROM points_markets m LEFT JOIN points_markets p ON p.id = m.parent_id
     WHERE m.mode = 'points' AND m.chain_id IS NULL AND m.chain_address IS NULL
       AND m.status = 'active' AND m.archived_at IS NULL
       AND (m.end_time IS NULL OR m.end_time > NOW())
       AND (m.tournament_featured IS TRUE OR p.tournament_featured IS TRUE)
       AND COALESCE(m.resolver_config->>'closesAt', m.end_time::text)::timestamptz
         BETWEEN $1::timestamptz AND $2::timestamptz
       AND (m.parent_id IS NULL OR COALESCE(p.resolver_config->>'closesAt', p.end_time::text)::timestamptz
         BETWEEN $1::timestamptz AND $2::timestamptz)
       AND jsonb_typeof(m.reserves) = 'array' AND jsonb_array_length(m.reserves) BETWEEN 2 AND 20
       AND jsonb_array_length(m.outcomes) = jsonb_array_length(m.reserves)
       AND ((m.parent_id IS NULL AND m.amm_mode IS DISTINCT FROM 'parallel')
         OR (m.parent_id IS NOT NULL AND jsonb_array_length(m.reserves) = 2
           AND p.amm_mode = 'parallel' AND p.parent_id IS NULL AND p.mode = 'points'
           AND p.chain_id IS NULL AND p.chain_address IS NULL
           AND p.status = 'active' AND p.archived_at IS NULL
           AND (p.end_time IS NULL OR p.end_time > NOW())))
       AND ($3::integer IS NULL OR m.id = $3)
     ORDER BY m.id ${lock ? 'FOR UPDATE OF m' : ''}`,
  [tournamentScoringStartsAt(window), window.rankingCutoffAt, marketId]);
}

export async function planPointsLiquidityRollout(client, { excludedMarketIds = [], getWindow = getTournamentWindow } = {}) {
  const window = getWindow();
  if (!window.active) throw new Error('tournament_not_active');
  const { rows } = await tournamentPools(client, window);
  const excluded = new Set([...PROTECTED_MARKET_IDS, ...excludedMarketIds.map(Number)]);
  const entries = [];
  const unchanged = [];
  for (const market of rows) {
    if (excluded.has(market.id)) continue;
    const fullRecommendedAmount = recommendMarketFunding(market.reserves);
    if (fullRecommendedAmount === null) throw new Error(`funding_target_unreachable:${market.id}`);
    if (!fullRecommendedAmount) { unchanged.push(market.id); continue; }
    const fundingFraction = market.category === 'deportes' ? 1 : POLICY.nonSportsFundingFraction;
    const amount = fullRecommendedAmount * fundingFraction;
    if (amount < 1) { unchanged.push(market.id); continue; }
    const plan = planMarketFunding(market.reserves, amount);
    entries.push({ marketId: market.id, question: market.question, category: market.category,
      requestId: randomUUID(), fullRecommendedAmount, fundingFraction, amount,
      expectedReserves: market.reserves, impactsBefore: impacts(market.reserves),
      impactsAfter: impacts(plan.reservesAfter) });
  }
  return { version: 2, policy: POLICY, window, createdAt: new Date().toISOString(), targets: LIQUIDITY_TARGETS,
    excludedMarketIds: [...excluded], inspectedPools: rows.length, unchanged,
    totalCollateral: entries.reduce((sum, entry) => sum + entry.amount, 0), entries };
}

export async function applyPointsLiquidityRollout(transaction, plan, { username, maxTotalCollateral, onResult = () => {}, getWindow = getTournamentWindow }) {
  if (plan?.version !== 2 || JSON.stringify(plan.policy) !== JSON.stringify(POLICY)
    || JSON.stringify(plan.targets) !== JSON.stringify(LIQUIDITY_TARGETS)) throw new Error('invalid_rollout_policy');
  const window = getWindow();
  if (!window.active || window.startsAt !== plan.window?.startsAt
    || window.rankingCutoffAt !== plan.window?.rankingCutoffAt) throw new Error('tournament_window_changed');
  if (!username || !Number.isFinite(maxTotalCollateral) || maxTotalCollateral <= 0) throw new Error('rollout_approval_required');
  const ids = new Set();
  const excluded = new Set([...PROTECTED_MARKET_IDS, ...plan.excludedMarketIds]);
  for (const entry of plan.entries) {
    if (!Number.isSafeInteger(entry.marketId) || entry.marketId <= 0 || ids.has(entry.marketId) || excluded.has(entry.marketId)) throw new Error('invalid_rollout_market');
    ids.add(entry.marketId);
    const fraction = entry.category === 'deportes' ? 1 : POLICY.nonSportsFundingFraction;
    const full = recommendMarketFunding(entry.expectedReserves);
    if (full === null || entry.fullRecommendedAmount !== full || entry.fundingFraction !== fraction
      || entry.amount !== full * fraction || entry.amount <= 0) throw new Error('invalid_rollout_amount');
  }
  const total = plan.entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (total !== plan.totalCollateral || total > maxTotalCollateral) throw new Error('rollout_budget_exceeded');
  const results = [];
  for (const entry of plan.entries) {
    let result;
    try {
      // Each pool commits independently; the saved plan's UUIDs make interrupted runs resumable.
      const funded = await transaction(async client => {
        const eligible = await tournamentPools(client, window, entry.marketId, true);
        if (eligible.rows.length !== 1 || eligible.rows[0].category !== entry.category) throw new Error('rollout_scope_changed');
        const result = await addPointsMarketFunding(client, {
          marketId: entry.marketId, amount: entry.amount, expectedReserves: entry.expectedReserves,
          requestId: entry.requestId, username,
        });
        if (entry.fundingFraction === 1 && impacts(result.reservesAfter).some(target => target.worstImpactPts > target.maxImpactPts)) throw new Error('funded_target_mismatch');
        return result;
      });
      const after = impacts(funded.reservesAfter);
      result = { marketId: entry.marketId, category: entry.category, fundingFraction: entry.fundingFraction,
        collateral: funded.collateral, replayed: Boolean(funded.replayed), impactsAfter: after };
    } catch (error) {
      if (!['funding_preview_stale', 'market_expired', 'market_not_active', 'rollout_scope_changed'].includes(error.message)) throw error;
      result = { marketId: entry.marketId, skipped: error.message };
    }
    results.push(result);
    await onResult(result);
  }
  return results;
}
