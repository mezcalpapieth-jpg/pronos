import { assertPointsExecution } from './points-execution-mode.js';
import { releaseOpenLimitOrdersForMarkets } from './points-limit-orders.js';

// Call inside withTransaction. This is the same remaining-cost-basis refund used by Admin.
export async function cancelPointsMarket(client, marketId, { actor, reason, expectedConfig = null, expectedOutcomes = null } = {}) {
  const found = await client.query(`SELECT id, status, parent_id, resolver_config, mode FROM points_markets WHERE id = $1 FOR UPDATE`, [marketId]);
  const market = found.rows[0];
  const fail = (message, status = 400, detail = null) => { throw Object.assign(new Error(message), { status, detail }); };
  if (!market) fail('market_not_found', 404);
  assertPointsExecution(market);
  if (market.parent_id) fail('cannot_cancel_leg_directly', 400, `Market ${marketId} is a leg of parent ${market.parent_id}. Cancel the parent instead.`);
  if (market.status !== 'active') fail('market_not_active', 400, `Current status is ${market.status}.`);
  if (expectedConfig) {
    const same = await client.query(`SELECT id FROM points_markets WHERE id = $1 AND resolver_type = 'api_chart'
      AND resolver_config = $2::jsonb AND ($3::jsonb IS NULL OR outcomes = $3::jsonb)`,
    [marketId, JSON.stringify(expectedConfig), expectedOutcomes ? JSON.stringify(expectedOutcomes) : null]);
    if (!same.rows.length) fail('market_contract_changed');
  }
  const related = await client.query(`SELECT id, mode FROM points_markets WHERE id = $1 OR parent_id = $1 ORDER BY id FOR UPDATE`, [marketId]);
  related.rows.forEach(assertPointsExecution);
  const ids = related.rows.map(r => Number(r.id));
  await releaseOpenLimitOrdersForMarkets(client, ids, { reason: 'market_cancelled', status: 'cancelled' });
  await client.query(`SELECT market_id, username, outcome_index, shares, cost_basis FROM points_positions
    WHERE market_id = ANY($1::int[]) AND shares > 0 FOR UPDATE`, [ids]);
  await client.query(`WITH refunds AS (
    SELECT username, SUM(cost_basis) AS amount FROM points_positions
    WHERE market_id = ANY($1::int[]) AND shares > 0 AND cost_basis > 0 GROUP BY username
  ) INSERT INTO points_balances (username, balance, updated_at)
    SELECT username, amount, NOW() FROM refunds
    ON CONFLICT (username) DO UPDATE SET balance = points_balances.balance + EXCLUDED.balance, updated_at = NOW()`, [ids]);
  const distributions = await client.query(`WITH refunds AS (
    SELECT username, market_id, SUM(cost_basis) AS amount FROM points_positions
    WHERE market_id = ANY($1::int[]) AND shares > 0 AND cost_basis > 0 GROUP BY username, market_id
  ) INSERT INTO points_distributions (username, amount, kind, reference_id, reason)
    SELECT username, amount, 'market_cancel_refund', market_id, $2 FROM refunds
    RETURNING username, amount, reference_id`, [ids, reason]);
  await client.query(`UPDATE points_positions SET shares = 0, cost_basis = 0, updated_at = NOW()
    WHERE market_id = ANY($1::int[]) AND shares > 0`, [ids]);
  await client.query(`UPDATE points_markets SET status = 'canceled', outcome = NULL, resolved_at = NOW(), resolved_by = $2
    WHERE id = ANY($1::int[]) AND status = 'active'`, [ids, actor]);
  return { ok: true, marketId: Number(marketId), canceledMarketIds: ids, refundCount: distributions.rows.length,
    totalRefunded: distributions.rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) };
}
