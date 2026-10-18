/**
 * Hourly price-history snapshot for off-chain points markets.
 *
 * Runs on a Vercel cron (see vercel.json — schedule `0 * * * *`). Flow:
 *   1. Load markets that are still open for trading.
 *   2. For each, compute the current prices from its reserves using the
 *      same AMM helpers the frontend does.
 *   3. Insert one row per market into `points_price_snapshots`.
 *   4. Garbage-collect old live history, preserving each closed market's
 *      last 60 days and one carry-forward anchor for historical charts.
 *
 * The result powers the sparkline on each market card — the UI fetches
 * the last 30 days of snapshots via /api/points/markets/price-history.
 *
 * Env vars:
 *   DATABASE_URL   (required)
 *   CRON_SECRET    (required in production; optional locally)
 *
 * GET /api/cron/points-snapshot-prices      — runs the snapshotter
 * GET /api/cron/points-snapshot-prices?dry=1 — reports candidates only
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { binaryPrices } from '../_lib/amm-math.js';

const sql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

// Mirrors the price-derivation logic in /api/points/markets.js. Kept
// inline so cron doesn't depend on the API module.
function pricesFromReserves(reserves, outcomeCount) {
  if (!Array.isArray(reserves) || reserves.length === 0) {
    return Array.from({ length: outcomeCount || 2 }, () => 1 / (outcomeCount || 2));
  }
  if (reserves.length === 2) return binaryPrices(reserves);
  const invs = reserves.map(r => (Number(r) > 0 ? 1 / Number(r) : 0));
  const total = invs.reduce((s, v) => s + v, 0) || 1;
  return invs.map(v => v / total);
}

export default async function handler(req, res) {
  // Standard cron guard — same pattern as /api/cron/auto-resolve.
  const secret = process.env.CRON_SECRET;
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);
  if (!secret) {
    if (isVercelDeploy) {
      return res.status(503).json({ error: 'CRON_SECRET not configured' });
    }
    // Local dev — allow through.
  } else {
    const provided = req.query.key || (req.headers.authorization || '').replace('Bearer ', '');
    if (provided !== secret) return res.status(401).json({ error: 'unauthorized' });
  }

  const dryRun = req.query.dry === '1' || req.query.dry === 'true';
  const started = Date.now();

  try {
    await ensurePointsSchema(sql);

    // A closed market's clock stops; repeatedly snapshotting its old
    // reserves after closing only adds flat history and unnecessary writes.
    // Parallel parents have empty reserves ([]) and exist only as display
    // containers — snapshotting them would produce garbage (uniform-prior
    // fallback). Legs snapshot normally because they're proper binary
    // markets (amm_mode='parallel' but parent_id IS NOT NULL).
    const markets = await sql`
      SELECT m.id, m.outcomes, m.reserves, m.status
      FROM points_markets m
      LEFT JOIN points_markets p ON p.id = m.parent_id
      WHERE m.status = 'active'
        AND (m.end_time IS NULL OR m.end_time > NOW())
        AND (p.id IS NULL OR (p.status = 'active' AND (p.end_time IS NULL OR p.end_time > NOW())))
        AND NOT (m.amm_mode = 'parallel' AND m.parent_id IS NULL)
      ORDER BY m.id ASC
    `;

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        count: markets.length,
        sample: markets.slice(0, 3).map(m => ({
          id: m.id,
          reserves: parseJsonb(m.reserves, []),
        })),
        elapsedMs: Date.now() - started,
      });
    }

    // Insert one periodic snapshot per open pool.
    let inserted = 0;
    for (const m of markets) {
      const outcomes = parseJsonb(m.outcomes, ['Sí', 'No']);
      const reserves = parseJsonb(m.reserves, []).map(Number);
      const prices = pricesFromReserves(reserves, outcomes.length);

      await sql`
        INSERT INTO points_price_snapshots (market_id, prices, reserves)
        VALUES (${m.id}, ${JSON.stringify(prices)}, ${JSON.stringify(reserves)})
      `;
      inserted += 1;
    }

    // Keep the existing closing history, not a second chart blob. Older
    // resolved charts must not disappear when the live retention advances.
    const purged = await sql`
      WITH cutoffs AS (
        SELECT m.id,
               LEAST(
                 CASE WHEN m.status = 'resolved' THEN COALESCE(m.resolved_at, m.end_time, m.created_at)
                   WHEN m.status = 'canceled' THEN LEAST(m.end_time, COALESCE(m.resolved_at, m.created_at)) ELSE m.end_time END,
                 CASE WHEN p.status = 'resolved' THEN COALESCE(p.resolved_at, p.end_time, p.created_at)
                   WHEN p.status = 'canceled' THEN LEAST(p.end_time, COALESCE(p.resolved_at, p.created_at)) ELSE p.end_time END
               ) AS closed_at
          FROM points_markets m
          LEFT JOIN points_markets p ON p.id = m.parent_id
      ), closed AS (
        SELECT c.id, c.closed_at,
               (SELECT s.id FROM points_price_snapshots s
                 WHERE s.market_id = c.id AND s.snapshotted_at < c.closed_at - INTERVAL '60 days'
                 ORDER BY s.snapshotted_at DESC, s.id DESC LIMIT 1) AS boundary_id
          FROM cutoffs c WHERE c.closed_at <= NOW()
      )
      DELETE FROM points_price_snapshots s
      WHERE s.snapshotted_at < NOW() - INTERVAL '60 days'
        AND NOT EXISTS (
          SELECT 1 FROM closed c WHERE c.id = s.market_id
            AND ((s.snapshotted_at >= c.closed_at - INTERVAL '60 days' AND s.snapshotted_at <= c.closed_at)
              OR s.id = c.boundary_id)
        )
      RETURNING s.id
    `;

    return res.status(200).json({
      ok: true,
      inserted,
      purged: purged.length,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/points-snapshot-prices] error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'snapshot_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
