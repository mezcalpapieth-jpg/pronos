/**
 * POST /api/points/admin/archive-market
 *   body: { marketId, archive: boolean }
 *
 * Soft-delete a market (archive=true) or undo (archive=false).
 *
 * Archived markets stay in the DB so positions + trades keep rendering
 * historical data, but are filtered out of every public list endpoint
 * (/api/points/markets, per-category pages, hero carousel, etc.) and
 * from admin list defaults. Admin can surface them via the "Archivados"
 * tab (which passes `status=archived`) or `?show_archived=1`.
 *
 * For parallel markets we cascade to every leg so parent + legs share
 * the same archived state.
 *
 * Idempotent: archiving an already-archived row just leaves archived_at
 * as-is; unarchiving a live one is a no-op.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { withTransaction } from '../../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const { marketId, archive } = req.body || {};
    const mid = Number.parseInt(marketId, 10);
    if (!Number.isInteger(mid) || mid <= 0) {
      return res.status(400).json({ error: 'invalid_market_id' });
    }
    if (typeof archive !== 'boolean') {
      return res.status(400).json({ error: 'archive_must_be_boolean' });
    }

    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      const mr = await client.query(
        `SELECT id, amm_mode, parent_id, archived_at
         FROM points_markets WHERE id = $1 FOR UPDATE`,
        [mid],
      );
      if (mr.rows.length === 0) {
        const err = new Error('market_not_found'); err.status = 404; throw err;
      }
      const row = mr.rows[0];
      // Admin can only archive a parent or a standalone market, not a
      // leg on its own — forcing that discipline keeps parent+legs in
      // lockstep (which the public list queries depend on).
      if (row.parent_id) {
        const err = new Error('cannot_archive_leg_directly'); err.status = 400;
        err.detail = `Market ${mid} is a leg of parent ${row.parent_id}. Archive the parent instead.`;
        throw err;
      }

      if (archive) {
        // Archive self + every leg in a single UPDATE. NOW() is captured
        // once per statement so parent + legs share the exact archived_at
        // timestamp.
        await client.query(
          `UPDATE points_markets SET archived_at = NOW()
           WHERE archived_at IS NULL
             AND (id = $1 OR parent_id = $1)`,
          [mid],
        );
      } else {
        await client.query(
          `UPDATE points_markets SET archived_at = NULL
           WHERE archived_at IS NOT NULL
             AND (id = $1 OR parent_id = $1)`,
          [mid],
        );
      }

      // Return the updated row so the admin UI can refresh without a GET.
      const updated = await client.query(
        `SELECT id, archived_at FROM points_markets WHERE id = $1`,
        [mid],
      );
      return updated.rows[0];
    });

    return res.status(200).json({
      ok: true,
      marketId: result.id,
      archivedAt: result.archived_at,
      actor: admin.username,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail || null });
    }
    console.error('[admin/archive-market] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'archive_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
