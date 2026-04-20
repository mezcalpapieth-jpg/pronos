/**
 * POST /api/points/admin/backfill-resolvers           — apply
 * POST /api/points/admin/backfill-resolvers?dry=1     — preview
 *
 * One-shot migration that patches already-approved points_markets
 * rows whose resolver_type is still NULL. Source of truth is the
 * points_pending_markets table — when admin approved a pending spec,
 * the pending row's approved_market_id was set to the new market's
 * id, so we join back on that FK and copy resolver_type +
 * resolver_config across.
 *
 * Necessary because resolver_type was added to the generators AFTER
 * those pending rows were approved; the SQL schema carries the
 * columns but individual market rows never received values. This
 * endpoint is idempotent — re-running only touches rows that still
 * have resolver_type IS NULL.
 *
 * Admin-only. Matches the rest of /api/points/admin/*.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_URL);

function parseJsonb(v, fb) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v !== 'string') return fb;
  try { return JSON.parse(v); } catch { return fb; }
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const admin = requirePointsAdmin(req, res);
    if (!admin) return;

    const dryRun = req.query.dry === '1' || req.query.dry === 'true';
    await ensurePointsSchema(sql);

    // Preview rows that WOULD be touched. Useful as a sanity check
    // before running the real mutation.
    const preview = await sql`
      SELECT m.id AS market_id,
             m.status,
             pm.id AS pending_id,
             pm.source,
             pm.source_event_id,
             pm.resolver_type,
             pm.resolver_config
      FROM points_markets m
      JOIN points_pending_markets pm ON pm.approved_market_id = m.id
      WHERE m.resolver_type IS NULL
        AND m.status = 'active'
        AND m.parent_id IS NULL
        AND pm.resolver_type IS NOT NULL
      ORDER BY m.end_time ASC NULLS LAST
      LIMIT 500
    `;

    if (dryRun) {
      return res.status(200).json({
        dryRun: true,
        candidateCount: preview.length,
        candidates: preview.slice(0, 50).map(r => ({
          marketId: r.market_id,
          pendingId: r.pending_id,
          source: r.source,
          sourceEventId: r.source_event_id,
          resolverType: r.resolver_type,
          resolverConfig: parseJsonb(r.resolver_config, null),
        })),
      });
    }

    // Apply the copy. Guarded with the same WHERE as the preview so
    // rows admin resolved between preview and apply are left alone.
    const updated = await sql`
      UPDATE points_markets m
      SET resolver_type   = pm.resolver_type,
          resolver_config = pm.resolver_config
      FROM points_pending_markets pm
      WHERE pm.approved_market_id = m.id
        AND m.resolver_type IS NULL
        AND m.status = 'active'
        AND m.parent_id IS NULL
        AND pm.resolver_type IS NOT NULL
      RETURNING m.id AS market_id, pm.resolver_type
    `;

    return res.status(200).json({
      ok: true,
      updatedCount: updated.length,
      byResolverType: updated.reduce((acc, r) => {
        acc[r.resolver_type] = (acc[r.resolver_type] || 0) + 1;
        return acc;
      }, {}),
      updated: updated.map(r => ({ marketId: r.market_id, resolverType: r.resolver_type })),
      reviewer: admin.username,
    });
  } catch (e) {
    console.error('[admin/backfill-resolvers] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'backfill_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
