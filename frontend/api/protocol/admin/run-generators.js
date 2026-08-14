/**
 * POST /api/protocol/admin/run-generators          — apply
 * POST /api/protocol/admin/run-generators?dry=1    — preview (no DB writes)
 *
 * MVP/on-chain generator trigger. Reuses the same generator registry as
 * Points, but writes candidates into protocol_pending_markets so MVP
 * approvals/rejections are independent from the points-app queue.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
import { runAllGenerators, upsertProtocolPending } from '../../_lib/run-generators.js';

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

    await ensureProtocolSchema(sql);
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

    const { inserted, updated, skipped } = await upsertProtocolPending(sql, allSpecs);

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
    console.error('[protocol/admin/run-generators] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'run_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
