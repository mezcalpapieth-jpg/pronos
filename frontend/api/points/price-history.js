/**
 * GET /api/points/price-history?ids=1,2,3&days=30
 *
 * Returns the hourly price snapshots for one or more markets over the
 * last `days` days (default 30, max 60). Used by the home grid and market
 * detail page to render sparkline charts without replaying every trade.
 *
 * NB: path is flat (not nested under `markets/`) because Vercel's
 * filesystem routing treats `markets/` as a directory and shadows the
 * sibling `markets.js` list endpoint when both exist at the same depth.
 *
 * Response shape — one entry per requested market id:
 *   {
 *     history: {
 *       "<marketId>": [
 *         { t: <unix seconds>, p: <probability 0-100 for outcome 0> }
 *       ],
 *       ...
 *     }
 *   }
 *
 * Only outcome 0 is returned — the sparkline on cards only shows the
 * "Sí/YES" curve. Multi-outcome markets can fetch additional indexes via
 * ?outcome=<n> (future work).
 *
 * No auth required — this is a public read.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS' });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = idsParam
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0)
      .slice(0, 200); // bound response size

    if (ids.length === 0) {
      return res.status(400).json({ error: 'invalid_ids' });
    }

    // Clamp days to [1, 60] so a caller can't force a huge result set.
    const daysRaw = parseInt(req.query.days, 10);
    const days = Number.isInteger(daysRaw) ? Math.max(1, Math.min(60, daysRaw)) : 30;

    // Outcome index (default 0 = Sí/YES). The sparkline only shows one
    // curve per card, so we only return one outcome to keep payload small.
    const outcomeRaw = parseInt(req.query.outcome, 10);
    const outcomeIdx = Number.isInteger(outcomeRaw) && outcomeRaw >= 0 ? outcomeRaw : 0;

    await ensurePointsSchema(schemaSql);

    // One SQL round-trip for every market, filtered by the cutoff. The
    // index (market_id, snapshotted_at DESC) makes this a fast range scan.
    const rows = await sql`
      SELECT market_id, prices, snapshotted_at
      FROM points_price_snapshots
      WHERE market_id = ANY(${ids}::int[])
        AND snapshotted_at >= NOW() - (${days} || ' days')::interval
      ORDER BY market_id ASC, snapshotted_at ASC
    `;

    // Group by market_id and project only the requested outcome.
    const history = {};
    for (const id of ids) history[id] = [];
    for (const r of rows) {
      const prices = parseJsonb(r.prices, []);
      const price = Number(prices[outcomeIdx]);
      if (!Number.isFinite(price)) continue;
      history[r.market_id].push({
        t: Math.floor(new Date(r.snapshotted_at).getTime() / 1000),
        // Snapshots store probability 0-1; the Sparkline component expects
        // 0-100 to match MVP CLOB series.
        p: Math.round(price * 10000) / 100,
      });
    }

    return res.status(200).json({ history });
  } catch (e) {
    console.error('[points/markets/price-history] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'db_unavailable',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
