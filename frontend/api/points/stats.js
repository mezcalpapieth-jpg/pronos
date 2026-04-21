/**
 * GET /api/points/stats
 *
 * Cheap counts for the home hero — total active markets (including
 * non-featured), total resolved, and featured (trending) subset.
 * Runs a single aggregate query and caches edge-side for 60s so
 * the hero's number stays fresh without hammering the DB.
 *
 * Why it's separate from /api/points/markets: the home page used to
 * derive activeCount from the Trending fetch, which defaults to
 * featured-only and caps at 100. That made the hero show ~70 when
 * the real active count was ~300. This endpoint ships just the
 * numbers, so the hero can stay honest without pulling every row.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    await ensurePointsSchema(schemaSql);

    const rows = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'active'   AND parent_id IS NULL)                      AS active_count,
        COUNT(*) FILTER (WHERE status = 'active'   AND parent_id IS NULL AND featured = true)  AS featured_count,
        COUNT(*) FILTER (WHERE status = 'resolved' AND parent_id IS NULL)                      AS resolved_count,
        COUNT(*) FILTER (WHERE status = 'active'   AND parent_id IS NULL
                         AND end_time IS NOT NULL AND end_time < NOW())                        AS pending_count,
        COALESCE(SUM(CASE WHEN status = 'active' AND parent_id IS NULL
                          THEN (SELECT COALESCE(SUM(collateral), 0)
                                FROM points_trades t WHERE t.market_id = m.id)
                          ELSE 0 END), 0)                                                       AS active_volume
      FROM points_markets m
    `;
    const r = rows[0] || {};

    // 60-second SWR on the Vercel edge keeps the hero snappy
    // without making admins wait a whole minute to see a new
    // market in the count. 's-maxage' covers edge caching;
    // 'stale-while-revalidate' serves stale for another 5 min
    // while a fresh fetch happens in the background.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

    return res.status(200).json({
      activeCount:   Number(r.active_count   || 0),
      featuredCount: Number(r.featured_count || 0),
      resolvedCount: Number(r.resolved_count || 0),
      pendingCount:  Number(r.pending_count  || 0),
      activeVolume:  Number(r.active_volume  || 0),
    });
  } catch (e) {
    console.error('[points/stats] error', { message: e?.message, code: e?.code });
    return res.status(500).json({
      error: 'stats_failed',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
