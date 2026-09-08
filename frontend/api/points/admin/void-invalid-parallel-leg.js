/**
 * POST /api/points/admin/void-invalid-parallel-leg
 * Body: { marketId? | legMarketId?, parentMarketId?, legLabel?, reason?, dryRun? }
 *
 * Cancels a single invalid leg in an active parallel points market,
 * refunds only that leg's open cost basis, and rewrites the parent
 * outcomes so the invalid option disappears from trading UI.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';
import {
  normalizeInvalidParallelLegRequest,
  voidInvalidParallelLeg,
} from '../../_lib/points-invalid-parallel-leg.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const normalized = normalizeInvalidParallelLegRequest(req.body || {});
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const dryRun = req.body?.dryRun !== false;

  try {
    await ensurePointsSchema(schemaSql);
    const result = await withTransaction(async (client) => (
      voidInvalidParallelLeg(client, {
        ...normalized,
        dryRun,
        adminUsername: admin.username,
      })
    ));
    return res.status(200).json(result);
  } catch (e) {
    console.error('[admin/void-invalid-parallel-leg] error', { message: e?.message, code: e?.code });
    return res.status(e?.status || 500).json({
      error: e?.message || 'void_invalid_parallel_leg_failed',
      detail: e?.detail || null,
      code: e?.code || null,
    });
  }
}
