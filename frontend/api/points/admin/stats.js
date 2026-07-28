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
import { cachedJson, createApiTimer, setCacheHeaders } from '../../_lib/api-performance.js';
import { PUBLICITY_SOURCES } from '../../_lib/publicity.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/admin/stats', { logThresholdMs: 250 });
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    setCacheHeaders(res, { scope: 'private', maxAge: 20, staleWhileRevalidate: 60 });
    const { value: payload, hit } = await cachedJson('points:admin:stats:v3', 20_000, async () => {
    await timer.time('schema_points', () => ensurePointsSchema(schemaSql));
    await timer.time('schema_interest', () => ensureInterestSchema(schemaSql));

    const [
      userRows,
      supplyRows,
      marketRows,
      distRows,
      teamInterestRows,
      marketInterestRows,
      volumeRows,
      siteTimeRows,
      publicityRows,
      activityRows,
    ] = await timer.time('db_admin_stats', () => Promise.all([
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
      sql`
        SELECT
          m.id,
          m.question,
          m.category,
          m.status,
          m.end_time,
          COALESCE(SUM(CASE WHEN t.side = 'buy' THEN t.collateral ELSE 0 END), 0) AS invested_volume,
          COALESCE(SUM(t.collateral), 0) AS gross_flow,
          COUNT(*) FILTER (WHERE t.side = 'buy')::int AS buy_count,
          COUNT(DISTINCT t.username)::int AS traders
        FROM points_markets m
        JOIN points_trades t ON t.market_id = m.id
        WHERE COALESCE(m.mode, 'points') = 'points'
        GROUP BY m.id, m.question, m.category, m.status, m.end_time
        ORDER BY invested_volume DESC, buy_count DESC, m.end_time DESC
        LIMIT 12
      `,
      sql`
        WITH totals AS (
          SELECT
            username,
            SUM(seconds)::int AS total_seconds,
            MAX(last_path) AS last_path,
            MAX(last_seen_at) AS last_seen_at
          FROM points_site_time_daily
          WHERE day >= CURRENT_DATE - INTERVAL '29 days'
          GROUP BY username
        ),
        grand AS (
          SELECT COALESCE(SUM(total_seconds), 0)::int AS total_seconds
          FROM totals
        )
        SELECT
          t.username,
          t.total_seconds,
          t.last_path,
          t.last_seen_at,
          grand.total_seconds AS all_seconds,
          CASE
            WHEN grand.total_seconds > 0 THEN (t.total_seconds::float / grand.total_seconds::float) * 100
            ELSE 0
          END AS share_pct
        FROM totals t
        CROSS JOIN grand
        ORDER BY t.total_seconds DESC, t.last_seen_at DESC
        LIMIT 12
      `,
      sql`
        SELECT
          source,
          COALESCE(SUM(visits) FILTER (WHERE day = CURRENT_DATE), 0)::int AS day_visits,
          COALESCE(SUM(visits) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_visits,
          COALESCE(SUM(visits) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_visits,
          COALESCE(SUM(visits), 0)::int AS lifetime_visits,
          COALESCE(SUM(unique_visitors) FILTER (WHERE day = CURRENT_DATE), 0)::int AS day_unique,
          COALESCE(SUM(unique_visitors) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_unique,
          COALESCE(SUM(unique_visitors) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_unique,
          COALESCE(SUM(unique_visitors), 0)::int AS lifetime_unique,
          COALESCE(SUM(conversions) FILTER (WHERE day = CURRENT_DATE), 0)::int AS day_conversions,
          COALESCE(SUM(conversions) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '6 days'), 0)::int AS week_conversions,
          COALESCE(SUM(conversions) FILTER (WHERE day >= CURRENT_DATE - INTERVAL '29 days'), 0)::int AS month_conversions,
          COALESCE(SUM(conversions), 0)::int AS lifetime_conversions,
          MAX(last_seen_at) AS last_seen_at
        FROM points_publicity_daily
        WHERE source IN ('instagram', 'tiktok', 'x')
        GROUP BY source
      `,
      sql`
        SELECT *
        FROM (
          SELECT
            t.created_at,
            t.username,
            'trade'::text AS kind,
            t.side::text AS action,
            t.collateral AS amount,
            t.market_id,
            m.question
          FROM points_trades t
          JOIN points_markets m ON m.id = t.market_id
          WHERE COALESCE(m.mode, 'points') = 'points'
          UNION ALL
          SELECT
            d.created_at,
            d.username,
            'distribution'::text AS kind,
            d.kind::text AS action,
            d.amount,
            d.reference_id AS market_id,
            d.reason AS question
          FROM points_distributions d
        ) activity
        ORDER BY created_at DESC
        LIMIT 40
      `,
    ]));

    return {
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
      volume: {
        markets: volumeRows.map(r => ({
          id: r.id,
          question: r.question,
          category: r.category,
          status: r.status,
          endTime: r.end_time,
          investedVolume: Number(r.invested_volume || 0),
          grossFlow: Number(r.gross_flow || 0),
          buyCount: Number(r.buy_count || 0),
          traders: Number(r.traders || 0),
        })),
      },
      siteTime: {
        totalSeconds: Number(siteTimeRows[0]?.all_seconds || 0),
        users: siteTimeRows.map(r => ({
          username: r.username,
          totalSeconds: Number(r.total_seconds || 0),
          sharePct: Number(r.share_pct || 0),
          lastPath: r.last_path,
          lastSeenAt: r.last_seen_at,
        })),
      },
      publicity: {
        sources: PUBLICITY_SOURCES.map(sourceMeta => {
          const row = publicityRows.find(item => item.source === sourceMeta.source) || {};
          const monthVisits = Number(row.month_visits || 0);
          const monthConversions = Number(row.month_conversions || 0);
          return {
            ...sourceMeta,
            dayVisits: Number(row.day_visits || 0),
            weekVisits: Number(row.week_visits || 0),
            monthVisits,
            lifetimeVisits: Number(row.lifetime_visits || 0),
            dayUnique: Number(row.day_unique || 0),
            weekUnique: Number(row.week_unique || 0),
            monthUnique: Number(row.month_unique || 0),
            lifetimeUnique: Number(row.lifetime_unique || 0),
            dayConversions: Number(row.day_conversions || 0),
            weekConversions: Number(row.week_conversions || 0),
            monthConversions,
            lifetimeConversions: Number(row.lifetime_conversions || 0),
            monthConversionRate: monthVisits > 0 ? (monthConversions / monthVisits) * 100 : 0,
            lastSeenAt: row.last_seen_at || null,
          };
        }),
      },
      activity: activityRows.map(r => ({
        createdAt: r.created_at,
        username: r.username,
        kind: r.kind,
        action: r.action,
        amount: Number(r.amount || 0),
        marketId: r.market_id,
        question: r.question,
      })),
    };
    });
    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ cache: hit ? 'hit' : 'miss' });
    return res.status(200).json(payload);
  } catch (e) {
    timer.end({ error: 'stats_failed' });
    console.error('[admin/stats] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'stats_failed' });
  }
}
