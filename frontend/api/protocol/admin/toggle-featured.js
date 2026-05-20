/**
 * POST /api/protocol/admin/toggle-featured
 * Body: { marketId, featured }
 *
 * Admin curation for MVP on-chain markets. This is the protocol-side
 * equivalent of the points flame: featured markets appear in home
 * Trending, while user-starred teams are only an additional overlay.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensureProtocolSchema } from '../../_lib/protocol-schema.js';
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
    if (typeof featured !== 'boolean') {
      return res.status(400).json({ error: 'featured_must_be_boolean' });
    }
    const mid = Number.parseInt(marketId, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }

    await ensureProtocolSchema(sql);

    const rows = await sql`
      UPDATE protocol_markets
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
  } catch (e) {
    console.error('[protocol/admin/toggle-featured] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'toggle_featured_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
