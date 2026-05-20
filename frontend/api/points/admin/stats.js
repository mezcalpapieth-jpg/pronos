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
import { ensureInterestSchema } from '../../_lib/interest-schema.js';
import { INTEREST_WINDOWS, formatInterestRow } from '../../_lib/interest.js';

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
    await ensureInterestSchema(schemaSql);

    const [userRows, supplyRows, marketRows, distRows, teamInterestRows, marketInterestRows] = await Promise.all([
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
      schemaSql`
        WITH daily AS (
          SELECT
            v.surface,
            v.object_type,
            v.object_id,
            v.day,
            COUNT(*)::int AS unique_count
          FROM interest_daily_visitors v
          WHERE v.object_type = 'team'
            AND v.action LIKE 'signal%'
          GROUP BY v.surface, v.object_type, v.object_id, v.day
        ),
        meta AS (
          SELECT
            surface,
            object_type,
            object_id,
            COALESCE(MAX(metadata->>'label'), object_id) AS label,
            MAX(metadata->>'question') AS question,
            MAX(metadata->>'sport') AS sport,
            MAX(metadata->>'league') AS league,
            MAX(metadata->>'category') AS category,
            MAX(metadata->>'status') AS status,
            MAX(last_seen_at) AS last_seen_at
          FROM interest_daily_counts
          WHERE object_type = 'team'
          GROUP BY surface, object_type, object_id
        )
        SELECT
          d.surface,
          d.object_type,
          d.object_id,
          COALESCE(MAX(meta.label), d.object_id) AS label,
          MAX(meta.question) AS question,
          MAX(meta.sport) AS sport,
          MAX(meta.league) AS league,
          MAX(meta.category) AS category,
          MAX(meta.status) AS status,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day = CURRENT_DATE), 0)::int AS day_count,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_count,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_count,
          COALESCE(SUM(d.unique_count), 0)::int AS lifetime_count,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day = CURRENT_DATE), 0)::int AS day_unique,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_unique,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_unique,
          COALESCE(SUM(d.unique_count), 0)::int AS lifetime_unique,
          MAX(meta.last_seen_at) AS last_seen_at,
          COALESCE(
            jsonb_agg(
              jsonb_build_object('day', d.day::text, 'count', d.unique_count, 'unique', d.unique_count)
              ORDER BY d.day
            ) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '29 days'),
            '[]'::jsonb
          ) AS series
        FROM daily d
        LEFT JOIN meta
          ON meta.surface = d.surface
         AND meta.object_type = d.object_type
         AND meta.object_id = d.object_id
        GROUP BY d.surface, d.object_type, d.object_id
        ORDER BY month_count DESC, lifetime_count DESC, last_seen_at DESC
        LIMIT 12
      `,
      schemaSql`
        WITH daily AS (
          SELECT
            v.surface,
            v.object_type,
            v.object_id,
            v.day,
            COUNT(*)::int AS unique_count
          FROM interest_daily_visitors v
          WHERE v.object_type IN ('points_market', 'protocol_market')
            AND v.action LIKE 'signal%'
          GROUP BY v.surface, v.object_type, v.object_id, v.day
        ),
        meta AS (
          SELECT
            surface,
            object_type,
            object_id,
            COALESCE(MAX(metadata->>'label'), MAX(metadata->>'question'), object_id) AS label,
            MAX(metadata->>'question') AS question,
            MAX(metadata->>'sport') AS sport,
            MAX(metadata->>'league') AS league,
            MAX(metadata->>'category') AS category,
            MAX(metadata->>'status') AS status,
            MAX(last_seen_at) AS last_seen_at
          FROM interest_daily_counts
          WHERE object_type IN ('points_market', 'protocol_market')
          GROUP BY surface, object_type, object_id
        )
        SELECT
          d.surface,
          d.object_type,
          d.object_id,
          COALESCE(MAX(meta.label), d.object_id) AS label,
          MAX(meta.question) AS question,
          MAX(meta.sport) AS sport,
          MAX(meta.league) AS league,
          MAX(meta.category) AS category,
          MAX(meta.status) AS status,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day = CURRENT_DATE), 0)::int AS day_count,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_count,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_count,
          COALESCE(SUM(d.unique_count), 0)::int AS lifetime_count,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day = CURRENT_DATE), 0)::int AS day_unique,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_unique,
          COALESCE(SUM(d.unique_count) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_unique,
          COALESCE(SUM(d.unique_count), 0)::int AS lifetime_unique,
          MAX(meta.last_seen_at) AS last_seen_at,
          COALESCE(
            jsonb_agg(
              jsonb_build_object('day', d.day::text, 'count', d.unique_count, 'unique', d.unique_count)
              ORDER BY d.day
            ) FILTER (WHERE d.day >= CURRENT_DATE - INTERVAL '29 days'),
            '[]'::jsonb
          ) AS series
        FROM daily d
        LEFT JOIN meta
          ON meta.surface = d.surface
         AND meta.object_type = d.object_type
         AND meta.object_id = d.object_id
        GROUP BY d.surface, d.object_type, d.object_id
        ORDER BY month_count DESC, lifetime_count DESC, last_seen_at DESC
        LIMIT 12
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
      interest: {
        windows: INTEREST_WINDOWS,
        teams: teamInterestRows.map(formatInterestRow),
        markets: marketInterestRows.map(formatInterestRow),
      },
    });
  } catch (e) {
    console.error('[admin/stats] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'stats_failed' });
  }
}
