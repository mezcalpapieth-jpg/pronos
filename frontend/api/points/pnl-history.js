/**
 * GET /api/points/pnl-history?username=<name>&days=30
 *
 * Cumulative PnL over time for one user — the series behind the chart on
 * the portfolio page and on public profiles.
 *
 * `username` is optional: without it the endpoint serves the authenticated
 * user (the portfolio's own chart), with it the endpoint serves the public
 * profile and requires no session. That mirrors the split between
 * /api/points/history (session-scoped) and /api/points/u (public), and the
 * response is safe either way — it is one aggregate number per timestamp,
 * strictly less than the per-market PnL /api/points/u already publishes.
 *
 * Response:
 *   { series: [{ t: <unix seconds>, v: <cumulative PnL> }], current: <number>,
 *     range: { days, from, to } }
 *
 * The maths lives in ../_lib/points-pnl-series.js so it stays unit-testable
 * without a database. See that file for how unrealized value is handled.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { readSession } from '../_lib/session.js';
import { buildPnlSeries } from '../_lib/points-pnl-series.js';
import { createApiTimer } from '../_lib/api-performance.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/pnl-history');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  // Public profile reads pass ?username=; the portfolio's own chart omits
  // it and falls back to the session. Usernames are stored lowercase, so
  // normalize or "Mezcal" misses the row saved as "mezcal".
  const raw = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  let username = raw ? raw.toLowerCase().slice(0, 32) : '';
  if (!username) {
    const session = readSession(req, res);
    if (!session?.username) return res.status(401).json({ error: 'auth_required' });
    username = String(session.username).toLowerCase();
  }

  const daysRaw = parseInt(req.query.days, 10);
  // 0 (or `all`) means "since the first trade" — the default view, since a
  // cumulative curve is most useful over the account's whole life.
  const days = Number.isInteger(daysRaw) && daysRaw > 0 ? Math.min(365, daysRaw) : 0;
  const nowMs = Date.now();
  const fromMs = days > 0 ? nowMs - days * 86_400_000 : 0;

  // Points-mode only, matching /api/points/history's default — the Points
  // app must never fold on-chain MVP trades into its numbers.
  const modeFilter = 'points';

  try {
    await timer.time('schema', () => ensurePointsSchema(schemaSql));

    const tradeRows = await timer.time('db_trades', () => sql`
      SELECT t.market_id, t.side, t.outcome_index, t.shares, t.collateral, t.created_at,
             m.status, m.outcome, m.resolved_at, m.outcomes
      FROM points_trades t
      JOIN points_markets m ON m.id = t.market_id
      WHERE LOWER(t.username) = ${username}
        AND COALESCE(m.mode, 'points') = ${modeFilter}
      ORDER BY t.created_at ASC
    `);

    if (tradeRows.length === 0) {
      timer.end({ series: 0 });
      return res.status(200).json({
        series: [],
        current: 0,
        range: { days, from: Math.round(fromMs / 1000), to: Math.round(nowMs / 1000) },
      });
    }

    const refundRows = await timer.time('db_refunds', () => sql`
      SELECT d.reference_id AS market_id, d.amount, d.created_at
      FROM points_distributions d
      JOIN points_markets m ON m.id = d.reference_id
      WHERE LOWER(d.username) = ${username}
        AND d.kind IN ('market_cancel_refund', 'void_refund', 'invalid_field_refund')
        AND COALESCE(m.mode, 'points') = ${modeFilter}
      ORDER BY d.created_at ASC
    `);

    const marketIds = [...new Set(tradeRows.map(r => Number(r.market_id)))];
    // Snapshots are fetched from the first trade onward, not from the
    // window start: replaying earlier trades needs the prices that were
    // live back then to value what the user was already holding.
    const snapshotRows = await timer.time('db_snapshots', () => sql`
      SELECT market_id, prices, snapshotted_at
      FROM points_price_snapshots
      WHERE market_id = ANY(${marketIds}::int[])
      ORDER BY snapshotted_at ASC
    `);

    const markets = new Map();
    for (const r of tradeRows) {
      const id = Number(r.market_id);
      if (markets.has(id)) continue;
      markets.set(id, {
        marketId: id,
        outcomeCount: parseJsonb(r.outcomes, ['Sí', 'No']).length || 2,
        status: r.status,
        outcome: r.outcome,
        resolvedAt: r.resolved_at,
      });
    }

    const { series, current } = buildPnlSeries({
      trades: tradeRows.map(r => ({
        marketId: Number(r.market_id),
        side: r.side,
        outcomeIndex: Number(r.outcome_index),
        shares: Number(r.shares),
        collateral: Number(r.collateral),
        createdAt: r.created_at,
      })),
      refunds: refundRows.map(r => ({
        marketId: Number(r.market_id),
        amount: Number(r.amount || 0),
        createdAt: r.created_at,
      })),
      markets: [...markets.values()],
      snapshots: snapshotRows.map(r => ({
        marketId: Number(r.market_id),
        prices: parseJsonb(r.prices, null),
        snapshottedAt: r.snapshotted_at,
      })),
      fromMs,
      nowMs,
    });

    timer.end({ series: series.length, trades: tradeRows.length });
    // Short cache: the curve only bends on trades, and the portfolio page
    // refetches on its own after a buy or sell.
    res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    return res.status(200).json({
      series,
      current,
      range: { days, from: Math.round(fromMs / 1000), to: Math.round(nowMs / 1000) },
    });
  } catch (e) {
    timer.end({ error: 'pnl_history_failed' });
    console.error('[points/pnl-history] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'pnl_history_failed' });
  }
}
