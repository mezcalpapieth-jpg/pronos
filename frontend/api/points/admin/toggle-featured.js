/**
 * POST /api/points/admin/toggle-featured
 *   body: { marketId?, pendingId?, featured: boolean }
 *
 * Flip the `featured` flag on either an already-created market
 * (`marketId` → points_markets) or a pending row in the admin queue
 * (`pendingId` → points_pending_markets). Exactly one id must be
 * provided; the pending flag carries over into points_markets at
 * approval time.
 *
 * Idempotent — a second call with the same value is a no-op.
 * Admin-only.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const { marketId, pendingId, featured } = req.body || {};
    if (typeof featured !== 'boolean') {
      return res.status(400).json({ error: 'featured_must_be_boolean' });
    }
    const mid = Number.parseInt(marketId, 10);
    const pid = Number.parseInt(pendingId, 10);
    const hasMarket  = Number.isInteger(mid) && mid > 0;
    const hasPending = Number.isInteger(pid) && pid > 0;
    if (hasMarket === hasPending) {
      return res.status(400).json({ error: 'supply_exactly_one_of_marketId_pendingId' });
    }

    await ensurePointsSchema(sql);

    if (hasMarket) {
      const rows = await sql`
        UPDATE points_markets
        SET featured = ${featured}
        WHERE id = ${mid}
        RETURNING id, featured
      `;
      if (rows.length === 0) {
        return res.status(404).json({ error: 'market_not_found' });
      }
      return res.status(200).json({
        ok: true,
        marketId: rows[0].id,
        featured: rows[0].featured,
        reviewer: admin.username,
      });
    }

    const rows = await sql`
      UPDATE points_pending_markets
      SET featured = ${featured}
      WHERE id = ${pid}
      RETURNING id, featured
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'pending_not_found' });
    }
    return res.status(200).json({
      ok: true,
      pendingId: rows[0].id,
      featured: rows[0].featured,
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/toggle-featured] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'toggle_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
