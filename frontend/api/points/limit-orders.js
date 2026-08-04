/**
 * GET  /api/points/limit-orders?marketId=<id>
 * POST /api/points/limit-orders
 *
 * Authenticated points limit orders. Buy orders reserve MXNP; sell orders
 * reserve shares. Execution is against the points AMM when the limit is
 * crossed, so this is a hybrid order book rather than a full CLOB.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import {
  createLimitOrder,
  estimateMakerReward,
  parseJsonb,
} from '../_lib/points-limit-orders.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function serializeOrder(row) {
  const parsedReserves = parseJsonb(row.market_reserves, []);
  const reserves = Array.isArray(parsedReserves) ? parsedReserves.map(Number) : [];
  const estimatedPendingReward = reserves.length >= 2
    ? estimateMakerReward(row, { end_time: row.market_end_time }, reserves)
    : 0;
  return {
    id: Number(row.id),
    marketId: Number(row.market_id),
    username: row.username,
    side: row.side,
    outcomeIndex: Number(row.outcome_index),
    limitPrice: Number(row.limit_price),
    amount: Number(row.amount),
    remainingAmount: Number(row.remaining_amount),
    reservedCollateral: Number(row.reserved_collateral || 0),
    reservedShares: Number(row.reserved_shares || 0),
    status: row.status,
    filledShares: Number(row.filled_shares || 0),
    filledCollateral: Number(row.filled_collateral || 0),
    avgFillPrice: row.avg_fill_price == null ? null : Number(row.avg_fill_price),
    makerRewardAccrued: Number(row.maker_reward_accrued || 0),
    makerRewardPaid: Number(row.maker_reward_paid || 0),
    makerRewardEstimated: Number(row.maker_reward_accrued || 0) + estimatedPendingReward,
    makerRewardLastAt: row.maker_reward_last_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    filledAt: row.filled_at,
    cancelledAt: row.cancelled_at,
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const limited = rateLimit(req, res, {
    key: `points-limit-orders:${clientIp(req)}:${req.method}`,
    limit: req.method === 'GET' ? 120 : 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);

    if (req.method === 'GET') {
      const marketId = Number.parseInt(req.query.marketId, 10);
      if (!Number.isInteger(marketId) || marketId <= 0) {
        return res.status(400).json({ error: 'invalid_market_id' });
      }
      const rows = await readSql`
        SELECT o.*,
               m.reserves AS market_reserves,
               m.end_time AS market_end_time
          FROM points_limit_orders o
          JOIN points_markets m ON m.id = o.market_id
         WHERE o.username = ${session.username}
           AND o.market_id = ${marketId}
           AND o.status = 'open'
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT 50
      `;
      return res.status(200).json({ orders: rows.map(serializeOrder) });
    }

    const {
      marketId,
      outcomeIndex,
      side,
      limitPrice,
      amount,
      expiresAt,
    } = req.body || {};
    const mid = Number.parseInt(marketId, 10);
    const oi = Number.parseInt(outcomeIndex, 10);
    if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
    if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome_index' });
    if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'invalid_order_side' });

    const result = await withTransaction((client) => createLimitOrder(client, {
      marketId: mid,
      username: session.username,
      side,
      outcomeIndex: oi,
      limitPrice,
      amount,
      expiresAt: expiresAt || null,
    }));

    return res.status(200).json({
      ok: true,
      order: serializeOrder(result.order),
      fill: result.fill,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[points/limit-orders] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'limit_order_failed' });
  }
}
