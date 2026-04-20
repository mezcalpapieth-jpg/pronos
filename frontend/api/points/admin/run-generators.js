/**
 * POST /api/points/admin/run-generators          — apply
 * POST /api/points/admin/run-generators?dry=1    — preview (no DB writes)
 *
 * Admin-auth'd manual trigger for the same batch the daily cron runs.
 * Exists because (a) Vercel only fires crons on production deploys, so
 * preview testing benefits from an on-demand button, and (b) Vercel
 * Hobby limits crons to 2 per project — if the scheduled cron gets
 * dropped, admin still has a way to kick the pipeline.
 *
 * Shares the generator registry + upsert logic with the cron via
 * _lib/run-generators.js, so the two endpoints stay in lockstep.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { runAllGenerators, upsertPending } from '../../_lib/run-generators.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dryRun = req.query.dry === '1' || req.query.dry === 'true';
    const started = Date.now();

    await ensurePointsSchema(sql);
    const { allSpecs, sourceStats } = await runAllGenerators();

    if (dryRun) {
      return res.status(200).json({
        ok: true,
        dryRun: true,
        sources: sourceStats,
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
      reviewer: admin.username,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    console.error('[admin/run-generators] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'run_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
