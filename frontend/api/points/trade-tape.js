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
import { binaryPrices, multiPrices } from '../_lib/amm-math.js';
import { readSession } from '../_lib/session.js';
import { isAdminUsername } from '../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);
const EXECUTION_BUCKET_MS = 2_000;
const EPSILON = 0.000001;

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

function parseReserves(value) {
  const reserves = parseJsonb(value, []);
  if (!Array.isArray(reserves)) return [];
  return reserves.map(Number).filter(n => Number.isFinite(n) && n > 0);
}

function reservePriceFor(value, outcomeIndex) {
  const reserves = parseReserves(value);
  const oi = Number(outcomeIndex);
  if (!Number.isInteger(oi) || oi < 0 || oi >= reserves.length) return null;
  try {
    const prices = reserves.length === 2 ? binaryPrices(reserves) : multiPrices(reserves);
    const price = Number(prices[oi]);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function executionBucket(row) {
  const ms = timestampMs(row.created_at);
  return ms > 0 ? Math.floor(ms / EXECUTION_BUCKET_MS) : Number(row.id || 0);
}

function outcomeLabelFor(row) {
  if (row.leg_label) return row.leg_label;
  const outcomes = parseJsonb(row.outcomes, []);
  const fromArray = outcomes[Number(row.outcome_index)];
  if (fromArray) return String(fromArray);
  return `Opción ${Number(row.outcome_index || 0) + 1}`;
}

function tradeGroupKey(row) {
  return [
    Number(row.display_market_id || row.market_id || 0),
    String(row.username || ''),
    String(row.side || ''),
    Number(row.outcome_index || 0),
    executionBucket(row),
  ].join(':');
}

function fillDetailFor(row) {
  const priceBefore = reservePriceFor(row.reserves_before, row.outcome_index);
  const priceAfter = reservePriceFor(row.reserves_after, row.outcome_index);
  return {
    id: Number(row.id),
    marketId: Number(row.market_id),
    outcomeIndex: Number(row.outcome_index || 0),
    outcomeLabel: outcomeLabelFor(row),
    side: row.side,
    shares: money(row.shares),
    collateral: money(row.collateral),
    fee: money(row.fee),
    price: toNumber(row.price_at_trade),
    priceBefore: priceBefore == null ? null : toNumber(priceBefore),
    priceAfter: priceAfter == null ? null : toNumber(priceAfter),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    t: row.created_at ? Math.floor(new Date(row.created_at).getTime() / 1000) : null,
  };
}

function createTradeGroup(row, includeDetails = false) {
  const createdMs = timestampMs(row.created_at);
  const price = toNumber(row.price_at_trade);
  const priceBefore = reservePriceFor(row.reserves_before, row.outcome_index);
  const priceAfter = reservePriceFor(row.reserves_after, row.outcome_index);
  return {
    id: Number(row.id),
    marketId: Number(row.market_id),
    displayMarketId: Number(row.display_market_id || row.market_id),
    username: String(row.username || ''),
    side: row.side,
    outcomeIndex: Number(row.outcome_index || 0),
    outcomeLabel: outcomeLabelFor(row),
    question: row.question || '',
    shares: 0,
    collateral: 0,
    fee: 0,
    priceWeightedTotal: 0,
    priceWeight: 0,
    priceBefore,
    priceAfter,
    priceMin: price > 0 ? price : null,
    priceMax: price > 0 ? price : null,
    fillCount: 0,
    firstCreatedMs: createdMs,
    lastCreatedMs: createdMs,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    fills: includeDetails ? [] : null,
  };
}

function addRowToTradeGroup(group, row, includeDetails = false) {
  const shares = Math.max(0, toNumber(row.shares));
  const collateral = Math.max(0, toNumber(row.collateral));
  const fee = Math.max(0, toNumber(row.fee));
  const price = toNumber(row.price_at_trade);
  const priceBefore = reservePriceFor(row.reserves_before, row.outcome_index);
  const priceAfter = reservePriceFor(row.reserves_after, row.outcome_index);
  const createdMs = timestampMs(row.created_at);
  const weight = shares > EPSILON ? shares : collateral;

  group.shares += shares;
  group.collateral += collateral;
  group.fee += fee;
  group.fillCount += 1;
  if (price > 0) {
    group.priceMin = group.priceMin == null ? price : Math.min(group.priceMin, price);
    group.priceMax = group.priceMax == null ? price : Math.max(group.priceMax, price);
    if (weight > EPSILON) {
      group.priceWeightedTotal += price * weight;
      group.priceWeight += weight;
    }
  }
  if (priceBefore != null && (group.priceBefore == null || createdMs <= group.firstCreatedMs)) {
    group.priceBefore = priceBefore;
  }
  if (
    priceAfter != null &&
    Math.abs(priceAfter - (priceBefore ?? priceAfter)) > EPSILON &&
    createdMs >= group.lastCreatedMs
  ) {
    group.priceAfter = priceAfter;
  } else if (priceAfter != null && group.priceAfter == null) {
    group.priceAfter = priceAfter;
  }
  if (createdMs > group.lastCreatedMs) {
    group.lastCreatedMs = createdMs;
    group.createdAt = new Date(row.created_at).toISOString();
    group.id = Number(row.id);
  }
  if (createdMs > 0 && (group.firstCreatedMs <= 0 || createdMs < group.firstCreatedMs)) {
    group.firstCreatedMs = createdMs;
  }
  if (includeDetails && Array.isArray(group.fills)) {
    group.fills.push(fillDetailFor(row));
  }
}

function serializeTradeGroup(group) {
  const avgPrice = group.priceWeight > EPSILON
    ? group.priceWeightedTotal / group.priceWeight
    : group.priceMax;
  const payload = {
    id: Number(group.id),
    marketId: Number(group.marketId),
    displayMarketId: Number(group.displayMarketId),
    username: group.username,
    side: group.side,
    outcomeIndex: Number(group.outcomeIndex || 0),
    outcomeLabel: group.outcomeLabel,
    question: group.question || '',
    shares: money(group.shares),
    collateral: money(group.collateral),
    fee: money(group.fee),
    price: toNumber(avgPrice),
    priceBefore: group.priceBefore == null ? null : toNumber(group.priceBefore),
    priceAfter: group.priceAfter == null ? null : toNumber(group.priceAfter),
    priceMin: group.priceMin == null ? null : toNumber(group.priceMin),
    priceMax: group.priceMax == null ? null : toNumber(group.priceMax),
    fillCount: Number(group.fillCount || 0),
    createdAt: group.createdAt,
    t: group.createdAt ? Math.floor(new Date(group.createdAt).getTime() / 1000) : null,
  };
  if (Array.isArray(group.fills)) {
    payload.fills = [...group.fills]
      .sort((a, b) => ((a.t || 0) - (b.t || 0)) || (Number(a.id) - Number(b.id)));
  }
  return payload;
}

function aggregateRows(rows, ids, limit, { includeDetails = false } = {}) {
  const byGroup = new Map();
  for (const row of rows) {
    const key = tradeGroupKey(row);
    if (!byGroup.has(key)) byGroup.set(key, createTradeGroup(row, includeDetails));
    addRowToTradeGroup(byGroup.get(key), row, includeDetails);
  }

  const grouped = {};
  for (const id of ids) grouped[id] = [];
  const groups = [...byGroup.values()]
    .sort((a, b) => (b.lastCreatedMs - a.lastCreatedMs) || (Number(b.id) - Number(a.id)));
  for (const group of groups) {
    const key = String(group.displayMarketId);
    if (!grouped[key]) grouped[key] = [];
    if (grouped[key].length >= limit) continue;
    grouped[key].push(serializeTradeGroup(group));
  }
  return grouped;
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
  const wantsDetails = req.query.details === '1' || req.query.details === 'true';
  let includeDetails = false;
  if (wantsDetails) {
    try {
      const session = readSession(req, res);
      includeDetails = isAdminUsername(session?.username);
    } catch {
      includeDetails = false;
    }
  }

  setCacheHeaders(res, includeDetails ? {
    scope: 'private',
    maxAge: 0,
    staleWhileRevalidate: 0,
  } : {
    scope: 'public',
    maxAge: 0,
    sMaxage: 2,
    staleWhileRevalidate: 10,
  });

  try {
    const cacheKey = `points:trade-tape:v3:${ids.join(',')}:${hours}:${limit}:${includeDetails ? 'details' : 'public'}`;
    const { value: payload, hit } = await cachedJson(cacheKey, includeDetails ? 0 : 2_000, async () => {
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
          t.reserves_before,
          t.reserves_after,
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
        LIMIT ${Math.min(limit * 16, 1600)}
      `);

      return { tape: aggregateRows(rows, ids, limit, { includeDetails }) };
    });

    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ hit, ids: ids.length, hours, limit, details: includeDetails });
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
