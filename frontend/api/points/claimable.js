/**
 * GET /api/points/claimable
 * Lightweight portfolio alert for resolved winning positions that still
 * have shares to redeem.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(p.shares), 0)::text AS payout
      FROM points_positions p
      JOIN points_markets m ON m.id = p.market_id
      WHERE p.username = ${session.username}
        AND p.shares > 0
        AND p.dismissed_at IS NULL
        AND COALESCE(m.mode, 'points') = 'points'
        AND m.status = 'resolved'
        AND m.outcome = p.outcome_index
    `;
    const row = rows[0] || {};
    return res.status(200).json({
      count: Number(row.count || 0),
      payout: round2(row.payout),
    });
  } catch (e) {
    console.error('[points/claimable] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'claimable_failed' });
  }
}
