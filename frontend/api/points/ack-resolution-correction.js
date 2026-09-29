/**
 * POST /api/points/ack-resolution-correction
 * Body: { correctionId }
 *
 * Lets a user acknowledge a resolution correction banner in their portfolio.
 * The correction audit row stays immutable; this only hides the per-user
 * notice after they have seen it.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const correctionId = Number.parseInt(req.body?.correctionId, 10);
  if (!Number.isInteger(correctionId) || correctionId <= 0) {
    return res.status(400).json({ error: 'invalid_correction_id' });
  }

  try {
    await ensurePointsSchema(sql);

    const eligible = await sql.query(
      `SELECT c.id
         FROM points_resolution_corrections c
        WHERE c.id = $1
          AND (
            EXISTS (
              SELECT 1
                FROM points_trades t
               WHERE t.username = $2
                 AND t.market_id IN (
                   SELECT value::int FROM jsonb_array_elements_text(c.affected_market_ids)
                 )
            )
            OR EXISTS (
              SELECT 1
                FROM points_distributions d
               WHERE d.username = $2
                 AND d.kind IN ('redemption', 'redemption_reversal', 'market_cancel_refund', 'void_refund', 'invalid_field_refund')
                 AND d.reference_id IN (
                   SELECT value::int FROM jsonb_array_elements_text(c.affected_market_ids)
                 )
            )
          )
        LIMIT 1`,
      [correctionId, session.username],
    );

    const eligibleRows = Array.isArray(eligible) ? eligible : (eligible.rows || []);
    if (eligibleRows.length === 0) {
      return res.status(404).json({ error: 'correction_not_found' });
    }

    const rows = await sql.query(
      `INSERT INTO points_resolution_correction_acknowledgments (
         correction_id, username, acknowledged_at
       ) VALUES ($1, $2, NOW())
       ON CONFLICT (correction_id, username)
       DO UPDATE SET acknowledged_at = EXCLUDED.acknowledged_at
       RETURNING correction_id, acknowledged_at`,
      [correctionId, session.username],
    );

    const resultRows = Array.isArray(rows) ? rows : (rows.rows || []);
    const row = resultRows[0] || {};
    return res.status(200).json({
      ok: true,
      correctionId: Number(row.correction_id || correctionId),
      acknowledgedAt: row.acknowledged_at || null,
    });
  } catch (e) {
    console.error('[points/ack-resolution-correction] error', {
      message: e?.message,
      code: e?.code,
    });
    return res.status(500).json({
      error: 'ack_resolution_correction_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
