/**
 * GET /api/points/admin/stats
 *
 * Dashboard stats for the points-app admin panel:
 *   - Users, MXNP in circulation, markets
 *   - Recent distributions by kind
 *   - Daily claim volume over the last N days
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(schemaSql);

    const [userRows, supplyRows, marketRows, distRows] = await Promise.all([
      sql`SELECT COUNT(*)::int AS c FROM points_users`,
      sql`SELECT COALESCE(SUM(balance), 0) AS total FROM points_balances`,
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
        FROM points_markets
      `,
      sql`
        SELECT kind, COALESCE(SUM(amount), 0) AS total, COUNT(*)::int AS count
        FROM points_distributions
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY kind
        ORDER BY SUM(ABS(amount)) DESC
      `,
    ]);

    return res.status(200).json({
      users: userRows[0].c,
      totalSupply: Number(supplyRows[0].total || 0),
      markets: marketRows[0],
      recentDistributions: distRows.map(r => ({
        kind: r.kind,
        total: Number(r.total),
        count: r.count,
      })),
    });
  } catch (e) {
    console.error('[admin/stats] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'stats_failed' });
  }
}
