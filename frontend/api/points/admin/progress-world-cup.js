/**
 * POST /api/points/admin/progress-world-cup          — apply
 * POST /api/points/admin/progress-world-cup?dry=1    — preview
 *
 * Repairs and progresses World Cup 2026 markets from ESPN:
 * - patches existing group-stage rows from manual to ESPN sports_api
 * - resolves completed group-stage markets and group-winner markets
 * - creates/patches knockout markets through the final weekend
 *
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { runWorldCupRepair } from '../../_lib/world-cup-repair.js';

const schemaSql = neon(process.env.DATABASE_URL);
const readSql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dry = req.query.dry === '1' || req.query.dry === 'true';
    await ensurePointsSchema(schemaSql);
    const report = await runWorldCupRepair({ sql: readSql, dry });
    return res.status(200).json({
      ...report,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/progress-world-cup] error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'progress_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
