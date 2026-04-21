/**
 * POST /api/points/admin/toggle-featured
 *   body: { marketId, featured: boolean }
 *
 * Flip the `featured` flag on a market. When true the market appears
 * on the home "Trending" grid; when false it only shows under
 * /c/<category>. Admin-only.
 *
 * Idempotent — a second call with the same value is a no-op.
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

    const { marketId, featured } = req.body || {};
    const id = Number.parseInt(marketId, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    if (typeof featured !== 'boolean') {
      return res.status(400).json({ error: 'featured_must_be_boolean' });
    }

    await ensurePointsSchema(sql);

    const rows = await sql`
      UPDATE points_markets
      SET featured = ${featured}
      WHERE id = ${id}
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
  } catch (e) {
    console.error('[admin/toggle-featured] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'toggle_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
