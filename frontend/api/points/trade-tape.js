/**
 * GET /api/points/trade-tape?ids=1,2&hours=168&limit=20
 *
 * Public latest-movements feed from the immutable trade log. Unlike
 * trade-activity, this intentionally shows usernames; unlike the internal
 * book/AMM diagnostics, it never exposes execution-source categories.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../_lib/api-performance.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { PRONOS_TREASURY_USERNAME } from '../_lib/points-limit-orders.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function parsePositiveInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

function outcomeLabelFor(row) {
  if (row.leg_label) return row.leg_label;
  const outcomes = parseJsonb(row.outcomes, []);
  const fromArray = outcomes[Number(row.outcome_index)];
  if (fromArray) return String(fromArray);
  return `Opción ${Number(row.outcome_index || 0) + 1}`;
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/trade-tape', { logThresholdMs: 180 });
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `points-trade-tape:${clientIp(req)}`,
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

  const hours = parsePositiveInt(req.query.hours, 24 * 7, { min: 1, max: 60 * 24 });
  const limit = parsePositiveInt(req.query.limit, 20, { min: 1, max: 100 });

  setCacheHeaders(res, {
    scope: 'public',
    maxAge: 0,
    sMaxage: 2,
    staleWhileRevalidate: 10,
  });

  try {
    const cacheKey = `points:trade-tape:v1:${ids.join(',')}:${hours}:${limit}`;
    const { value: payload, hit } = await cachedJson(cacheKey, 2_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(schemaSql));
      const rows = await timer.time('db_trade_tape', () => sql`
        SELECT
          t.id,
          t.market_id,
          COALESCE(m.parent_id, m.id) AS display_market_id,
          t.username,
          t.side,
          t.outcome_index,
          t.shares,
          t.collateral,
          t.fee,
          t.price_at_trade,
          t.created_at,
          m.question,
          m.outcomes,
          m.leg_label
        FROM points_trades t
        JOIN points_markets m ON m.id = t.market_id
        WHERE (t.market_id = ANY(${ids}::int[]) OR m.parent_id = ANY(${ids}::int[]))
          AND t.side IN ('buy', 'sell')
          AND t.username <> ${PRONOS_TREASURY_USERNAME}
          AND t.created_at >= NOW() - (${hours} || ' hours')::interval
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT ${limit * 8}
      `);

      const grouped = {};
      for (const id of ids) grouped[id] = [];
      for (const row of rows) {
        const displayMarketId = Number(row.display_market_id || row.market_id);
        const key = String(displayMarketId);
        if (!grouped[key]) grouped[key] = [];
        if (grouped[key].length >= limit) continue;
        const createdAt = row.created_at ? new Date(row.created_at).toISOString() : null;
        grouped[key].push({
          id: Number(row.id),
          marketId: Number(row.market_id),
          displayMarketId,
          username: String(row.username || ''),
          side: row.side,
          outcomeIndex: Number(row.outcome_index || 0),
          outcomeLabel: outcomeLabelFor(row),
          question: row.question || '',
          shares: money(row.shares),
          collateral: money(row.collateral),
          fee: money(row.fee),
          price: toNumber(row.price_at_trade),
          createdAt,
          t: createdAt ? Math.floor(new Date(createdAt).getTime() / 1000) : null,
        });
      }

      return { tape: grouped };
    });

    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ hit, ids: ids.length, hours, limit });
    return res.status(200).json(payload);
  } catch (e) {
    timer.end({ error: true });
    console.error('[points/trade-tape] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
