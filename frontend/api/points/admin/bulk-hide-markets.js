/**
 * POST /api/points/admin/bulk-hide-markets
 *   body: { mode?: 'points' | 'onchain', dryRun?: boolean, expectedCount?: number }
 *
 * Removes active markets from the public home/trending surface without
 * archiving them. Category pages, direct links, trading, history, and
 * resolution keep working. The 🏆 tournament override still shows even
 * after this pass.
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

    const {
      mode = 'points',
      dryRun,
      expectedCount,
    } = req.body || {};

    if (mode !== 'points' && mode !== 'onchain') {
      return res.status(400).json({ error: 'invalid_mode', detail: 'mode must be "points" or "onchain"' });
    }

    const isDryRun = dryRun === true;
    const requireMatch = !isDryRun && Number.isInteger(expectedCount) && expectedCount >= 0;

    await ensurePointsSchema(schemaSql);

    const whereClause = `
      status = 'active'
      AND parent_id IS NULL
      AND archived_at IS NULL
      AND COALESCE(mode, 'points') = $1
    `;

    if (isDryRun) {
      const result = await schemaSql.query(
        `SELECT COUNT(*)::int AS n
           FROM points_markets
          WHERE ${whereClause}`,
        [mode],
      );
      const n = Number(result?.[0]?.n ?? result?.rows?.[0]?.n ?? 0);
      return res.status(200).json({
        ok: true,
        dryRun: true,
        mode,
        wouldHideCount: n,
        actor: admin.username,
      });
    }

    const { count } = await withTransaction(async (client) => {
      if (requireMatch) {
        const c = await client.query(
          `SELECT COUNT(*)::int AS n
             FROM points_markets
            WHERE ${whereClause}`,
          [mode],
        );
        const live = Number(c.rows[0]?.n || 0);
        if (live !== expectedCount) {
          const err = new Error('count_mismatch');
          err.status = 409;
          err.detail = { expectedCount, liveCount: live };
          throw err;
        }
      }

      const result = await client.query(
        `UPDATE points_markets
            SET featured = false,
                auto_featured = false,
                hidden_from_home = true
          WHERE ${whereClause}`,
        [mode],
      );
      return { count: result.rowCount || 0 };
    });

    return res.status(200).json({
      ok: true,
      dryRun: false,
      mode,
      hiddenCount: count,
      actor: admin.username,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[admin/bulk-hide-markets] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'bulk_hide_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
