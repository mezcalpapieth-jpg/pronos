/**
 * GET /api/points/orderbook?marketId=<id>&outcomeIndex=<idx>&levels=<n>
 *
 * Hybrid points order book. User bids/asks come from reserved limit
 * orders; AMM rows show incremental, fee-inclusive depth from the same
 * reserves used by the trade router, not independent synthetic liquidity.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { AMM_DEPTH_LEVELS, buildAmmDepth } from '../_lib/amm-depth.js';
import { aggregateLimitOrderRows } from '../_lib/points-limit-orders.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../_lib/api-performance.js';
import { TOURNAMENT_APPROVED_MARKET_START_ISO } from '../_lib/points-tournament-config.js';

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
    const cacheKey = `points:orderbook:v9:${marketId}:${outcomeIndex}:${requestedLevels.join(',')}`;
    const { value: payload, hit } = await cachedJson(cacheKey, 1_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(schemaSql));
      const rows = await timer.time('db_market', () => sql`
        SELECT m.id, m.parent_id, m.leg_label, m.question, m.status, m.outcomes, m.reserves,
               m.seed_liquidity, m.seed_liquidities,
               (
                 m.tournament_featured IS TRUE
                 OR p.tournament_featured IS TRUE
                 OR COALESCE(pm.reviewed_at, p.created_at, m.created_at) >= ${TOURNAMENT_APPROVED_MARKET_START_ISO}::timestamptz
               ) AS tournament_featured
        FROM points_markets m
        LEFT JOIN points_markets p ON p.id = m.parent_id
        LEFT JOIN points_pending_markets pm ON pm.approved_market_id = COALESCE(m.parent_id, m.id)
        WHERE m.id = ${marketId}
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
        incremental: true,
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
           AND remaining_amount > 0
           AND (expires_at IS NULL OR expires_at > NOW())
         GROUP BY side, limit_price
      `);
      const limitBook = aggregateLimitOrderRows(limitRows);
      const asks = [...limitBook.asks, ...depth.asks]
        .sort((a, b) => b.price - a.price)
        .slice(0, requestedLevels.length + limitBook.asks.length);
      const bids = [...limitBook.bids, ...depth.bids]
        .sort((a, b) => b.price - a.price)
        .slice(0, requestedLevels.length + limitBook.bids.length);
      const bestAsk = [...limitBook.asks, ...depth.asks].reduce(
        (best, row) => (best == null || row.price < best ? row.price : best),
        null,
      );
      const bestBid = [...limitBook.bids, ...depth.bids].reduce(
        (best, row) => (best == null || row.price > best ? row.price : best),
        null,
      );
      const spread = bestAsk == null || bestBid == null
        ? null
        : Math.max(0, bestAsk - bestBid);
      const currentPrice = depth.currentPrice;

      return {
        marketId,
        outcomeIndex,
        outcomeLabel,
        status: market.status,
        currentPrice,
        lastPrice: currentPrice,
        ammPrice: depth.currentPrice,
        spread,
        asks,
        bids,
        bookType: 'hybrid_orderbook',
        limitAskCount: limitBook.asks.reduce((sum, row) => sum + (Number(row.orderCount) || 0), 0),
        limitBidCount: limitBook.bids.reduce((sum, row) => sum + (Number(row.orderCount) || 0), 0),
        ammAskCount: depth.asks.length,
        ammBidCount: depth.bids.length,
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
