/**
 * GET /api/points/trade-activity?ids=1,2&days=1&outcome=0&buckets=48
 *
 * Returns bucketed, anonymous buy/sell activity from the immutable trade log.
 * The chart uses this as an activity layer under the real price line; it does
 * not synthesize prices or expose individual users.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../_lib/api-performance.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parsePositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/trade-activity', { logThresholdMs: 180 });
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `points-trade-activity:${clientIp(req)}`,
    limit: 180,
    windowMs: 60_000,
  });
  if (limited) return;

  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const ids = idsParam
    .split(',')
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  if (ids.length === 0) {
    return res.status(400).json({ error: 'invalid_ids' });
  }

  const days = parsePositiveInt(req.query.days, 1, { min: 1, max: 60 });
  const outcomeIdx = parsePositiveInt(req.query.outcome, 0, { min: 0, max: 200 });
  const buckets = parsePositiveInt(req.query.buckets, 48, { min: 12, max: 120 });
  const bucketSeconds = Math.max(60, Math.ceil((days * 86_400) / buckets));

  setCacheHeaders(res, {
    scope: 'public',
    maxAge: 0,
    sMaxage: 2,
    staleWhileRevalidate: 10,
  });

  try {
    const cacheKey = `points:trade-activity:v1:${ids.join(',')}:${days}:${outcomeIdx}:${buckets}`;
    const { value: payload, hit } = await cachedJson(cacheKey, 2_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(schemaSql));
      const rows = await timer.time('db_trade_activity', () => sql`
        WITH raw AS (
          SELECT
            market_id,
            side,
            collateral,
            TO_TIMESTAMP(
              FLOOR(EXTRACT(EPOCH FROM created_at) / ${bucketSeconds}) * ${bucketSeconds}
            ) AS bucket_at
          FROM points_trades
          WHERE market_id = ANY(${ids}::int[])
            AND outcome_index = ${outcomeIdx}
            AND side IN ('buy', 'sell')
            AND created_at >= NOW() - (${days} || ' days')::interval
        )
        SELECT
          market_id,
          bucket_at,
          COUNT(*)::int AS count,
          COALESCE(SUM(collateral), 0)::text AS volume,
          COALESCE(SUM(CASE WHEN side = 'buy' THEN collateral ELSE 0 END), 0)::text AS buy_volume,
          COALESCE(SUM(CASE WHEN side = 'sell' THEN collateral ELSE 0 END), 0)::text AS sell_volume
        FROM raw
        GROUP BY market_id, bucket_at
        ORDER BY market_id ASC, bucket_at ASC
      `);

      const activity = {};
      for (const id of ids) activity[id] = [];
      for (const r of rows) {
        activity[r.market_id].push({
          t: Math.floor(new Date(r.bucket_at).getTime() / 1000),
          count: Number(r.count) || 0,
          volume: Math.round(toNumber(r.volume) * 100) / 100,
          buyVolume: Math.round(toNumber(r.buy_volume) * 100) / 100,
          sellVolume: Math.round(toNumber(r.sell_volume) * 100) / 100,
        });
      }

      return { activity, bucketSeconds };
    });

    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ hit, ids: ids.length, days, outcome: outcomeIdx, buckets });
    return res.status(200).json(payload);
  } catch (e) {
    timer.end({ error: true });
    console.error('[points/trade-activity] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
