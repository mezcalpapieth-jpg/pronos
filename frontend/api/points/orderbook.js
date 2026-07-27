/**
 * GET /api/points/orderbook?marketId=<id>&outcomeIndex=<idx>&levels=<n>
 *
 * AMM-backed market depth for the points app. This is not a resting
 * limit-order CLOB; every row is derived from the same buy/sell quote
 * math that the trading endpoints execute.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { buildAmmDepth, AMM_DEPTH_LEVELS } from '../_lib/amm-depth.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function levelSet(count) {
  const n = Math.max(1, Math.min(12, Number(count) || AMM_DEPTH_LEVELS.length));
  return AMM_DEPTH_LEVELS.slice(0, n);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `points-orderbook:${clientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (limited) return;

  const marketId = parseInt(req.query.marketId, 10);
  const outcomeIndex = parseInt(req.query.outcomeIndex ?? '0', 10);
  const levels = parseInt(req.query.levels ?? String(AMM_DEPTH_LEVELS.length), 10);
  if (!Number.isInteger(marketId) || marketId <= 0) {
    return res.status(400).json({ error: 'invalid_market_id' });
  }
  if (!Number.isInteger(outcomeIndex) || outcomeIndex < 0) {
    return res.status(400).json({ error: 'invalid_outcome_index' });
  }

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT id, parent_id, leg_label, question, status, outcomes, reserves
      FROM points_markets
      WHERE id = ${marketId}
      LIMIT 1
    `;
    if (rows.length === 0) return res.status(404).json({ error: 'market_not_found' });

    const market = rows[0];
    const outcomes = parseJsonb(market.outcomes, ['Sí', 'No']);
    const reserves = parseJsonb(market.reserves, []).map(Number);
    const outcomeLabel = market.leg_label || outcomes[outcomeIndex] || `Opción ${outcomeIndex + 1}`;

    if (market.status !== 'active') {
      return res.status(200).json({
        marketId,
        outcomeIndex,
        outcomeLabel,
        status: market.status,
        currentPrice: null,
        lastPrice: null,
        spread: null,
        asks: [],
        bids: [],
      });
    }

    const depth = buildAmmDepth({
      reserves,
      outcomeIndex,
      levels: levelSet(levels),
    });
    const lastRows = await sql`
      SELECT price_at_trade
      FROM points_trades
      WHERE market_id = ${marketId}
        AND outcome_index = ${outcomeIndex}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `;
    const lastPrice = lastRows.length > 0
      ? Number(lastRows[0].price_at_trade)
      : depth.currentPrice;

    return res.status(200).json({
      marketId,
      outcomeIndex,
      outcomeLabel,
      status: market.status,
      currentPrice: depth.currentPrice,
      lastPrice: Number.isFinite(lastPrice) ? lastPrice : depth.currentPrice,
      spread: depth.spread,
      asks: depth.asks,
      bids: depth.bids,
    });
  } catch (e) {
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-depth') || msg.includes('amm-math')) {
      return res.status(400).json({ error: 'invalid_orderbook', detail: e.message });
    }
    console.error('[points/orderbook] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'orderbook_failed' });
  }
}
