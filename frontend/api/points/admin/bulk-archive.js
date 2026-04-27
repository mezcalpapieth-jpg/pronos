/**
 * POST /api/points/admin/bulk-archive
 *   body: { mode: 'points' | 'onchain', includeNullMode?: boolean }
 *
 * Mass-archive every active or resolved market in the given mode.
 * Useful for wiping legacy off-chain markets when starting fresh on
 * a new chain or when the off-chain Points app is deprecated.
 *
 * `includeNullMode: true` (default when mode='points') also archives
 * rows whose `mode` column is NULL — older markets created before the
 * mode classifier landed in M3. That's almost always what you want
 * when cleaning up "legacy points markets".
 *
 * Cascades through parallel parents → legs (same UPDATE, single
 * timestamp). Soft-delete only — rows stay in the DB so trade history
 * + positions endpoints keep returning accurate past data, they just
 * stop appearing in any public list.
 *
 * Returns: { archivedAt, archivedCount, mode }.
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

    const { mode, includeNullMode } = req.body || {};
    if (mode !== 'points' && mode !== 'onchain') {
      return res.status(400).json({ error: 'invalid_mode', detail: 'mode must be "points" or "onchain"' });
    }
    // For 'points' mode the sane default is to also sweep NULLs (legacy
    // rows from before the column existed). Caller can opt out with
    // `includeNullMode: false`. For 'onchain' mode NULLs aren't onchain
    // by definition, so always exclude them.
    const sweepNulls = mode === 'points'
      ? (includeNullMode !== false)
      : false;

    await ensurePointsSchema(schemaSql);

    const { count } = await withTransaction(async (client) => {
      const result = await client.query(
        sweepNulls
          ? `UPDATE points_markets
               SET archived_at = NOW()
             WHERE archived_at IS NULL
               AND (COALESCE(mode, 'points') = $1)`
          : `UPDATE points_markets
               SET archived_at = NOW()
             WHERE archived_at IS NULL
               AND mode = $1`,
        [mode],
      );
      return { count: result.rowCount || 0 };
    });

    return res.status(200).json({
      ok: true,
      mode,
      includedNullMode: sweepNulls,
      archivedCount: count,
      actor: admin.username,
    });
  } catch (e) {
    console.error('[admin/bulk-archive] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'bulk_archive_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
