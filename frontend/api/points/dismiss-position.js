/**
 * POST /api/points/dismiss-position
 *   body: { marketId, outcomeIndex }
 *
 * Mark a resolved losing position as acknowledged so it stops
 * showing on the Active portfolio tab. Only operates on positions
 * where the market is resolved AND the user's outcome didn't win
 * (winning positions need to go through redeem-winnings, not dismiss).
 *
 * Idempotent — second call with the same args is a no-op.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.username) return res.status(400).json({ error: 'username_required' });

    const { marketId, outcomeIndex } = req.body || {};
    const mid = Number.parseInt(marketId, 10);
    const oidx = Number.parseInt(outcomeIndex, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    if (!Number.isInteger(oidx) || oidx < 0) {
      return res.status(400).json({ error: 'invalid_outcome_index' });
    }

    await ensurePointsSchema(sql);

    // Guard: only dismiss if the market is actually resolved AND
    // this position wasn't the winner. A winner would be losing
    // redemption value if we hid it; an active market still has
    // trade value and should stay visible.
    const rows = await sql`
      UPDATE points_positions p
      SET dismissed_at = NOW()
      FROM points_markets m
      WHERE p.market_id = ${mid}
        AND p.username = ${session.username}
        AND p.outcome_index = ${oidx}
        AND m.id = p.market_id
        AND m.status = 'resolved'
        AND (m.outcome IS NULL OR m.outcome <> p.outcome_index)
      RETURNING p.market_id, p.outcome_index, p.dismissed_at
    `;

    if (rows.length === 0) {
      return res.status(400).json({
        error: 'not_dismissable',
        detail: 'position not found, market still active, or outcome is the winner',
      });
    }
    return res.status(200).json({
      ok: true,
      marketId: rows[0].market_id,
      outcomeIndex: rows[0].outcome_index,
      dismissedAt: rows[0].dismissed_at,
    });
  } catch (e) {
    console.error('[points/dismiss-position] error', {
      message: e?.message, code: e?.code,
    });
    return res.status(500).json({
      error: 'dismiss_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
