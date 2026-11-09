import { createHash } from 'node:crypto';
import { PRONOS_TREASURY_USERNAME } from './points-limit-orders.js';

export function settlementRevision(values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function settlementError(message, status = 400, detail = null) {
  return Object.assign(new Error(message), { status, detail });
}

export function assertExpectedResolution(market, expectedResolvedAt) {
  if (expectedResolvedAt === undefined) return;
  const current = market.resolved_at == null ? null : new Date(market.resolved_at).toISOString();
  if (current !== expectedResolvedAt) throw settlementError('resolution_changed', 409);
}

export async function readSettlementPreview(client, ids, { winners = new Map(), cancel = false } = {}) {
  const positions = await client.query(
    `WITH targets AS (
       SELECT * FROM jsonb_to_recordset($2::jsonb) AS t(market_id int, outcome_index int)
     )
     SELECT COUNT(DISTINCT p.username)::int AS holders,
       COALESCE(SUM(CASE WHEN $3::boolean THEN p.cost_basis ELSE p.shares END), 0)::text AS total
     FROM points_positions p
     LEFT JOIN targets t ON p.market_id = t.market_id AND p.outcome_index = t.outcome_index
     WHERE p.market_id = ANY($1::int[]) AND p.shares > 0
       AND (($3 AND p.cost_basis > 0) OR (NOT $3 AND t.market_id IS NOT NULL AND p.username <> $4))`,
    [ids, JSON.stringify([...winners].map(([market_id, outcome_index]) => ({ market_id, outcome_index }))), cancel, PRONOS_TREASURY_USERNAME],
  );
  const orders = await client.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(reserved_collateral), 0)::text AS reserved
     FROM points_limit_orders WHERE market_id = ANY($1::int[]) AND status = 'open'`,
    [ids],
  );
  return {
    holderCount: positions.rows[0].holders,
    amount: positions.rows[0].total,
    orderCount: orders.rows[0].count,
    reservedAmount: orders.rows[0].reserved,
  };
}
