/**
 * GET /api/points/orderbook?marketId=<id>&outcomeIndex=<idx>&levels=<n>
 *
 * Hybrid points order book. User bids/asks come from reserved limit
 * orders; AMM depth stays as fallback liquidity so the book remains
 * executable while real resting orders are sparse.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { buildAmmDepth, AMM_DEPTH_LEVELS } from '../_lib/amm-depth.js';
import { aggregateLimitOrderRows } from '../_lib/points-limit-orders.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../_lib/api-performance.js';

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

  const requestedLevels = levelSet(levels);
  const timer = createApiTimer(res, 'points/orderbook', { logThresholdMs: 220 });
  setCacheHeaders(res, {
    scope: 'public',
    maxAge: 0,
    sMaxage: 1,
    staleWhileRevalidate: 5,
  });

  try {
    const cacheKey = `points:orderbook:v2:${marketId}:${outcomeIndex}:${requestedLevels.join(',')}`;
    const { value: payload, hit } = await cachedJson(cacheKey, 1_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(schemaSql));
      const rows = await timer.time('db_market', () => sql`
        SELECT id, parent_id, leg_label, question, status, outcomes, reserves
        FROM points_markets
        WHERE id = ${marketId}
        LIMIT 1
      `);
      if (rows.length === 0) {
        const err = new Error('market_not_found');
        err.statusCode = 404;
        throw err;
      }

      const market = rows[0];
      const outcomes = parseJsonb(market.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(market.reserves, []).map(Number);
      const outcomeLabel = market.leg_label || outcomes[outcomeIndex] || `Opción ${outcomeIndex + 1}`;

      if (market.status !== 'active') {
        return {
          marketId,
          outcomeIndex,
          outcomeLabel,
          status: market.status,
          currentPrice: null,
          lastPrice: null,
          spread: null,
          asks: [],
          bids: [],
        };
      }

      const depth = buildAmmDepth({
        reserves,
        outcomeIndex,
        levels: requestedLevels,
      });
      const limitRows = await timer.time('db_limit_orders', () => sql`
        SELECT side,
               limit_price,
               SUM(remaining_amount)::text AS remaining_amount,
               COUNT(*)::int AS order_count
          FROM points_limit_orders
         WHERE market_id = ${marketId}
           AND outcome_index = ${outcomeIndex}
           AND status = 'open'
         GROUP BY side, limit_price
      `);
      const limitBook = aggregateLimitOrderRows(limitRows);
      const ammAsks = depth.asks.map(row => ({ ...row, source: 'amm' }));
      const ammBids = depth.bids.map(row => ({ ...row, source: 'amm' }));
      const asks = [...limitBook.asks, ...ammAsks]
        .sort((a, b) => b.price - a.price)
        .slice(0, requestedLevels.length + limitBook.asks.length);
      const bids = [...limitBook.bids, ...ammBids]
        .sort((a, b) => b.price - a.price)
        .slice(0, requestedLevels.length + limitBook.bids.length);
      const bestAsk = [...limitBook.asks, ...ammAsks].reduce(
        (best, row) => (best == null || row.price < best ? row.price : best),
        null,
      );
      const bestBid = [...limitBook.bids, ...ammBids].reduce(
        (best, row) => (best == null || row.price > best ? row.price : best),
        null,
      );
      const spread = bestAsk == null || bestBid == null
        ? depth.spread
        : Math.max(0, bestAsk - bestBid);
      const lastRows = await timer.time('db_last_trade', () => sql`
        SELECT price_at_trade
        FROM points_trades
        WHERE market_id = ${marketId}
          AND outcome_index = ${outcomeIndex}
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `);
      const lastPrice = lastRows.length > 0
        ? Number(lastRows[0].price_at_trade)
        : depth.currentPrice;

      return {
        marketId,
        outcomeIndex,
        outcomeLabel,
        status: market.status,
        currentPrice: depth.currentPrice,
        lastPrice: Number.isFinite(lastPrice) ? lastPrice : depth.currentPrice,
        spread,
        asks,
        bids,
        bookType: 'hybrid',
        limitAskCount: limitBook.asks.reduce((sum, row) => sum + (Number(row.orderCount) || 0), 0),
        limitBidCount: limitBook.bids.reduce((sum, row) => sum + (Number(row.orderCount) || 0), 0),
      };
    });
    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ cache: hit ? 'hit' : 'miss' });
    return res.status(200).json(payload);
  } catch (e) {
    if (e?.statusCode === 404) {
      timer.end({ error: 'market_not_found' });
      return res.status(404).json({ error: 'market_not_found' });
    }
    const msg = (e?.message || '').toLowerCase();
    if (msg.includes('amm-depth') || msg.includes('amm-math')) {
      timer.end({ error: 'invalid_orderbook' });
      return res.status(400).json({ error: 'invalid_orderbook', detail: e.message });
    }
    console.error('[points/orderbook] error', { message: e?.message, code: e?.code });
    timer.end({ error: 'orderbook_failed' });
    return res.status(500).json({ error: 'orderbook_failed' });
  }
}
