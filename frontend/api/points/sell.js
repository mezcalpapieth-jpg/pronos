/**
 * POST /api/points/sell
 * Body: { marketId, outcomeIndex, shares }
 *
 * Off-chain MXNP early exit. The locked trading math lives in
 * _lib/points-trading-service.js so web and public API trades execute
 * through the same business path.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';
import { capturePointsRiskEvent } from '../_lib/points-risk.js';
import { executePointsSell } from '../_lib/points-trading-service.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `sell:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { marketId, outcomeIndex, shares, minCollateralOut } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(outcomeIndex, 10);
  const n = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'invalid_shares' });

  const username = session.username;

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction((client) => executePointsSell(client, {
      username,
      marketId: mid,
      outcomeIndex: oi,
      shares: n,
      minCollateralOut,
      source: 'web',
    }));

    await capturePointsRiskEvent(schemaSql, req, {
      username,
      accountId: session.sub,
      eventType: 'trade:sell',
      marketId: mid,
      tradeSide: 'sell',
      outcomeIndex: oi,
      amount: result.collateralOut,
      shares: result.sharesSold,
      metadata: {
        requestedShares: n,
        realizedPnl: result.realizedPnl,
        priceBefore: result.priceBefore,
        priceAfter: result.priceAfter,
        orderbookFillCount: Array.isArray(result.orderbookFills) ? result.orderbookFills.length : 0,
        triggeredLimitOrderCount: Array.isArray(result.triggeredLimitOrders) ? result.triggeredLimitOrders.length : 0,
      },
    });

    const { orderbookFills, triggeredLimitOrders, ...publicResult } = result;
    return res.status(200).json({
      ok: true,
      ...publicResult,
      orderbookFillCount: Array.isArray(orderbookFills) ? orderbookFills.length : 0,
      triggeredLimitOrderCount: Array.isArray(triggeredLimitOrders) ? triggeredLimitOrders.length : 0,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/sell] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'sell_failed' });
  }
}
