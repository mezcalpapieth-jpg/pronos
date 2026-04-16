/**
 * POST /api/points/admin/resolve-market
 * Body: { marketId, winningOutcomeIndex }
 *
 * Flips the market to resolved + sets the winning outcome. Users with
 * winning shares can now call /api/points/redeem.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  const { marketId, winningOutcomeIndex } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(winningOutcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0) return res.status(400).json({ error: 'invalid_outcome' });

  try {
    await ensurePointsSchema(sql);
    const rows = await sql`
      UPDATE points_markets
      SET status = 'resolved', outcome = ${oi}, resolved_at = NOW(), resolved_by = ${admin.username}
      WHERE id = ${mid} AND status = 'active'
      RETURNING id
    `;
    if (rows.length === 0) {
      return res.status(400).json({ error: 'market_not_active' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[admin/resolve-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'resolve_failed' });
  }
}
