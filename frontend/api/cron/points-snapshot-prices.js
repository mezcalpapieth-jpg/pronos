/**
 * Hourly price-history snapshot for off-chain points markets.
 *
 * Runs on a Vercel cron (see vercel.json — schedule `0 * * * *`). Flow:
 *   1. Load every active (not resolved) market.
 *   2. For each, compute the current prices from its reserves using the
 *      same AMM helpers the frontend does.
 *   3. Insert one row per market into `points_price_snapshots`.
 *   4. Garbage-collect snapshots older than 60 days so the table stays
 *      bounded even if we run hourly forever.
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

    // Snapshot every market that's still active OR was resolved within the
    // last 24h — this gives the sparkline a "final" point to flatten against
    // right after resolution.
    const markets = await sql`
      SELECT id, outcomes, reserves, status
      FROM points_markets
      WHERE status = 'active'
         OR (status = 'resolved' AND resolved_at > NOW() - INTERVAL '24 hours')
      ORDER BY id ASC
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

    // Batch-insert one row per market. We use a single multi-row INSERT to
    // keep this to one round-trip over Neon HTTP.
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

    // Bounded retention — drop anything older than 60 days. 60×24 = 1440
    // snapshots per market at peak, fine for Neon free tier.
    const purged = await sql`
      DELETE FROM points_price_snapshots
      WHERE snapshotted_at < NOW() - INTERVAL '60 days'
      RETURNING id
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
