/**
 * POST /api/points/admin/bulk-archive
 *   body: { mode: 'points' | 'onchain', includeNullMode?: boolean,
 *           dryRun?: boolean, expectedCount?: number }
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
 * Two-phase safety:
 *   - `dryRun: true` returns the count of rows that *would* be archived
 *     without touching them. The admin UI calls this first to show
 *     "About to archive N markets — confirm?".
 *   - On the real call (no dryRun), `expectedCount` lets the client
 *     pin the count it saw in the dry-run pass. If the live count has
 *     drifted (concurrent admin / new market created since preview),
 *     we reject with `count_mismatch` so the admin re-confirms with
 *     fresh numbers instead of archiving an unexpected total.
 *
 * Cascades through parallel parents → legs (same UPDATE, single
 * timestamp). Soft-delete only — rows stay in the DB so trade history
 * + positions endpoints keep returning accurate past data, they just
 * stop appearing in any public list.
 *
 * Returns: { archivedAt, archivedCount, mode, dryRun }.
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

    const { mode, includeNullMode, dryRun, expectedCount } = req.body || {};
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
    const isDryRun = dryRun === true;
    const requireMatch = !isDryRun && Number.isInteger(expectedCount) && expectedCount >= 0;

    await ensurePointsSchema(schemaSql);

    const whereClause = sweepNulls
      ? `archived_at IS NULL AND COALESCE(mode, 'points') = $1`
      : `archived_at IS NULL AND mode = $1`;

    if (isDryRun) {
      // Preview path: just count. No transaction, no UPDATE.
      const result = await schemaSql.query(
        `SELECT COUNT(*)::int AS n FROM points_markets WHERE ${whereClause}`,
        [mode],
      );
      const n = Number(result?.[0]?.n ?? result?.rows?.[0]?.n ?? 0);
      return res.status(200).json({
        ok: true,
        dryRun: true,
        mode,
        includedNullMode: sweepNulls,
        wouldArchiveCount: n,
        actor: admin.username,
      });
    }

    const { count } = await withTransaction(async (client) => {
      // If the caller pinned an `expectedCount`, count first inside the
      // transaction and reject if it doesn't match. This guards against
      // the "I clicked confirm 5 minutes later and meanwhile 200 new
      // markets got generated" failure mode.
      if (requireMatch) {
        const c = await client.query(
          `SELECT COUNT(*)::int AS n FROM points_markets WHERE ${whereClause}`,
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
        `UPDATE points_markets SET archived_at = NOW() WHERE ${whereClause}`,
        [mode],
      );
      return { count: result.rowCount || 0 };
    });

    return res.status(200).json({
      ok: true,
      dryRun: false,
      mode,
      includedNullMode: sweepNulls,
      archivedCount: count,
      actor: admin.username,
    });
  } catch (e) {
    // Tagged errors thrown inside the transaction (currently:
    // count_mismatch) carry their own status + detail. Pass those
    // through verbatim so the admin UI can render a useful message.
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[admin/bulk-archive] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'bulk_archive_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
