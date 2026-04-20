/**
 * Daily agent that discovers upcoming events and upserts them into
 * points_pending_markets for admin approval.
 *
 * Runs on a Vercel cron (see vercel.json). Per-source generators live
 * in `api/_lib/market-gen/*` — the shared registry + upsert loop lives
 * in `_lib/run-generators.js` so the admin "Generar ahora" button can
 * call the same code path without duplicating the logic.
 *
 * Env vars:
 *   CRON_SECRET             (required in production)
 *   FOOTBALL_DATA_API_KEY   (required for soccer generator; missing → skip)
 *
 * GET /api/cron/generate-markets-pending              — runs the generator batch
 * GET /api/cron/generate-markets-pending?dry=1        — builds specs, returns them
 *                                                       without DB writes
 */

import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { runAllGenerators, upsertPending } from '../_lib/run-generators.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  // Standard cron-secret guard, matches other /api/cron endpoints.
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
    const { allSpecs, sourceStats } = await runAllGenerators();

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        sources: sourceStats,
        specs: allSpecs.slice(0, 20),
        totalSpecs: allSpecs.length,
        elapsedMs: Date.now() - started,
      });
    }

    const { inserted, updated, skipped } = await upsertPending(sql, allSpecs);

    return res.status(200).json({
      ok: true,
      sources: sourceStats,
      total: allSpecs.length,
      inserted,
      updated,
      skipped,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[cron/generate-markets-pending] fatal', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'generate_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
