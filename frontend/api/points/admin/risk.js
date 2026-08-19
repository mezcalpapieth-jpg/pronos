/**
 * GET  /api/points/admin/risk
 * POST /api/points/admin/risk
 *
 * Points-only abuse review surface. This endpoint exposes hashed-signal
 * clusters and trading patterns to admins, but it never moves balances,
 * positions, distributions, or rewards automatically.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import {
  normalizeRiskReviewStatus,
  RISK_REVIEW_STATUSES,
} from '../../_lib/points-risk.js';
import { PRONOS_TREASURY_USERNAME } from '../../_lib/points-limit-orders.js';

let readSql;
let schemaSql;

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

function getReadSql() {
  if (!readSql) {
    const databaseUrl = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
    if (!databaseUrl) {
      const err = new Error('DATABASE_URL not configured');
      err.status = 500;
      throw err;
    }
    readSql = neon(databaseUrl);
  }
  return readSql;
}

function getSchemaSql() {
  if (!schemaSql) {
    if (!process.env.DATABASE_URL) {
      const err = new Error('DATABASE_URL not configured');
      err.status = 500;
      throw err;
    }
    schemaSql = neon(process.env.DATABASE_URL);
  }
  return schemaSql;
}

function normalizeUsername(value) {
  const username = String(value || '').toLowerCase().trim();
  return USERNAME_RE.test(username) ? username : null;
}

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatAccountRow(row) {
  return {
    username: row.username,
    email: row.email || null,
    balance: toNumber(row.balance),
    reviewStatus: row.reviewStatus || 'clear',
    reviewReason: row.reviewReason || '',
    reviewUpdatedAt: row.reviewUpdatedAt || null,
    riskScore: toNumber(row.riskScore),
    tradeCount: toNumber(row.tradeCount),
    marketCount: toNumber(row.marketCount),
    buyVolume: toNumber(row.buyVolume),
    exitVolume: toNumber(row.exitVolume),
    loopCount: toNumber(row.loopCount),
    rapidTradeCount: toNumber(row.rapidTradeCount),
    sharedSignalCount: toNumber(row.sharedSignalCount),
    sharedSignals: asArray(row.sharedSignals).map(formatLinkedSignalRow),
    lastTradeAt: row.lastTradeAt || null,
    createdAt: row.createdAt || null,
  };
}

function formatRiskTradeRow(row) {
  return {
    id: toNumber(row.id),
    side: row.side || '',
    outcomeIndex: row.outcomeIndex == null ? null : toNumber(row.outcomeIndex),
    outcomeLabel: row.outcomeLabel || '',
    collateral: toNumber(row.collateral),
    shares: toNumber(row.shares),
    price: toNumber(row.price),
    createdAt: row.createdAt || null,
  };
}

function formatRapidLoopRow(row) {
  return {
    username: row.username,
    marketId: toNumber(row.marketId),
    question: row.question || '',
    category: row.category || '',
    status: row.status || '',
    tradeCount: toNumber(row.tradeCount),
    buyCount: toNumber(row.buyCount),
    sellCount: toNumber(row.sellCount),
    buyCollateral: toNumber(row.buyCollateral),
    sellCollateral: toNumber(row.sellCollateral),
    outcomesTouched: toNumber(row.outcomesTouched),
    firstTradeAt: row.firstTradeAt || null,
    lastTradeAt: row.lastTradeAt || null,
    spanSeconds: toNumber(row.spanSeconds),
    trades: asArray(row.trades).map(formatRiskTradeRow),
  };
}

function formatLinkedSignalRow(row) {
  return {
    signalType: row.signalType,
    signalKey: row.signalKey,
    usernames: asArray(row.usernames),
    linkedUsernames: asArray(row.linkedUsernames),
    userCount: toNumber(row.userCount),
    eventCount: toNumber(row.eventCount),
    firstSeenAt: row.firstSeenAt || null,
    lastSeenAt: row.lastSeenAt || null,
  };
}

function formatSameMarketLinkRow(row) {
  return {
    marketId: toNumber(row.marketId),
    question: row.question || '',
    signalType: row.signalType,
    usernameA: row.usernameA,
    usernameB: row.usernameB,
    overlapCount: toNumber(row.overlapCount),
    firstSeenAt: row.firstSeenAt || null,
    lastSeenAt: row.lastSeenAt || null,
  };
}

function formatFlagRow(row) {
  return {
    id: toNumber(row.id),
    username: row.username,
    flagType: row.flagType,
    severity: toNumber(row.severity),
    status: row.status,
    marketId: row.marketId == null ? null : toNumber(row.marketId),
    relatedUsernames: asArray(row.relatedUsernames),
    details: row.details || {},
    createdAt: row.createdAt || null,
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(getSchemaSql());
  } catch (err) {
    console.error('[admin/risk] schema error', { message: err?.message, code: err?.code });
    return res.status(500).json({ error: 'schema_failed' });
  }

  if (req.method === 'GET') return handleList(req, res);
  if (req.method === 'POST') return handleReview(req, res, admin.username);
  return res.status(405).json({ error: 'method_not_allowed' });
}

async function handleList(req, res) {
  const sql = getReadSql();
  const usernameFilter = normalizeUsername(req.query.username);
  const rawStatus = String(req.query.status || '').trim().toLowerCase();
  const statusFilter = rawStatus === 'all' ? null : normalizeRiskReviewStatus(rawStatus);
  const statusParam = rawStatus && rawStatus !== 'all' ? statusFilter : null;

  try {
    const [
      accountRows,
      rapidLoopRows,
      linkedSignalRows,
      sameMarketRows,
      flagRows,
    ] = await Promise.all([
      sql`
        WITH trade_summary AS (
          SELECT
            username,
            COUNT(*)::int AS trade_count,
            COUNT(DISTINCT market_id)::int AS market_count,
            COALESCE(SUM(CASE WHEN side = 'buy' THEN collateral ELSE 0 END), 0)::float AS buy_volume,
            COALESCE(SUM(CASE WHEN side IN ('sell', 'redeem') THEN collateral ELSE 0 END), 0)::float AS exit_volume,
            MAX(created_at) AS last_trade_at
          FROM points_trades
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username <> ${PRONOS_TREASURY_USERNAME}
          GROUP BY username
        ),
        loops AS (
          SELECT
            username,
            COUNT(*)::int AS loop_count,
            COALESCE(SUM(trade_count), 0)::int AS rapid_trade_count
          FROM (
            SELECT
              username,
              market_id,
              COUNT(*)::int AS trade_count,
              COUNT(*) FILTER (WHERE side = 'buy')::int AS buy_count,
              COUNT(*) FILTER (WHERE side = 'sell')::int AS sell_count,
              MAX(created_at) - MIN(created_at) AS span
            FROM points_trades
            WHERE created_at > NOW() - INTERVAL '14 days'
              AND username <> ${PRONOS_TREASURY_USERNAME}
            GROUP BY username, market_id
            HAVING COUNT(*) >= 4
               AND COUNT(*) FILTER (WHERE side = 'buy') > 0
               AND COUNT(*) FILTER (WHERE side = 'sell') > 0
               AND MAX(created_at) - MIN(created_at) <= INTERVAL '6 hours'
          ) looped
          GROUP BY username
        ),
        shared AS (
          WITH signals AS (
            SELECT username, 'ip' AS signal_type, ip_hash AS signal_hash, created_at
            FROM points_risk_events
            WHERE created_at > NOW() - INTERVAL '30 days'
              AND username IS NOT NULL
              AND username <> ${PRONOS_TREASURY_USERNAME}
              AND ip_hash IS NOT NULL
            UNION ALL
            SELECT username, 'device' AS signal_type, device_hash AS signal_hash, created_at
            FROM points_risk_events
            WHERE created_at > NOW() - INTERVAL '30 days'
              AND username IS NOT NULL
              AND username <> ${PRONOS_TREASURY_USERNAME}
              AND device_hash IS NOT NULL
            UNION ALL
            SELECT username, 'session' AS signal_type, session_hash AS signal_hash, created_at
            FROM points_risk_events
            WHERE created_at > NOW() - INTERVAL '30 days'
              AND username IS NOT NULL
              AND username <> ${PRONOS_TREASURY_USERNAME}
              AND session_hash IS NOT NULL
          ),
          clusters AS (
            SELECT
              signal_type,
              signal_hash,
              ARRAY_AGG(DISTINCT username ORDER BY username) AS usernames,
              COUNT(DISTINCT username)::int AS user_count,
              COUNT(*)::int AS event_count,
              MIN(created_at) AS first_seen_at,
              MAX(created_at) AS last_seen_at
            FROM signals
            GROUP BY signal_type, signal_hash
            HAVING COUNT(DISTINCT username) > 1
          )
          SELECT
            u.username,
            COUNT(*)::int AS shared_signal_count,
            JSONB_AGG(
              JSONB_BUILD_OBJECT(
                'signalType', c.signal_type,
                'signalKey', LEFT(c.signal_hash, 12),
                'usernames', c.usernames,
                'linkedUsernames', (
                  SELECT COALESCE(JSONB_AGG(linked.linked_username ORDER BY linked.linked_username), '[]'::jsonb)
                  FROM unnest(c.usernames) AS linked(linked_username)
                  WHERE LOWER(linked.linked_username) <> LOWER(u.username)
                ),
                'userCount', c.user_count,
                'eventCount', c.event_count,
                'firstSeenAt', c.first_seen_at,
                'lastSeenAt', c.last_seen_at
              )
              ORDER BY c.user_count DESC, c.event_count DESC, c.last_seen_at DESC
            ) AS shared_signals
          FROM clusters c
          CROSS JOIN LATERAL unnest(c.usernames) AS u(username)
          GROUP BY u.username
        )
        SELECT
          u.username AS "username",
          u.email AS "email",
          u.created_at AS "createdAt",
          COALESCE(b.balance, 0)::float AS "balance",
          COALESCE(r.status, 'clear') AS "reviewStatus",
          COALESCE(r.reason, '') AS "reviewReason",
          r.updated_at AS "reviewUpdatedAt",
          COALESCE(t.trade_count, 0)::int AS "tradeCount",
          COALESCE(t.market_count, 0)::int AS "marketCount",
          COALESCE(t.buy_volume, 0)::float AS "buyVolume",
          COALESCE(t.exit_volume, 0)::float AS "exitVolume",
          COALESCE(l.loop_count, 0)::int AS "loopCount",
          COALESCE(l.rapid_trade_count, 0)::int AS "rapidTradeCount",
          COALESCE(s.shared_signal_count, 0)::int AS "sharedSignalCount",
          COALESCE(s.shared_signals, '[]'::jsonb) AS "sharedSignals",
          t.last_trade_at AS "lastTradeAt",
          (
            CASE COALESCE(r.status, 'clear')
              WHEN 'ineligible' THEN 100
              WHEN 'under_review' THEN 70
              WHEN 'phone_required' THEN 55
              WHEN 'watch' THEN 35
              ELSE 0
            END
            + COALESCE(l.loop_count, 0) * 30
            + COALESCE(s.shared_signal_count, 0) * 20
            + LEAST(COALESCE(t.trade_count, 0), 30)
            + CASE
                WHEN COALESCE(t.buy_volume, 0) > 0
                 AND COALESCE(t.exit_volume, 0) > 0
                 AND ABS(COALESCE(t.buy_volume, 0) - COALESCE(t.exit_volume, 0)) / NULLIF(t.buy_volume, 0) < 0.15
                THEN 10
                ELSE 0
              END
          )::int AS "riskScore"
        FROM points_users u
        LEFT JOIN points_balances b ON LOWER(b.username) = LOWER(u.username)
        LEFT JOIN points_account_reviews r ON LOWER(r.username) = LOWER(u.username)
        LEFT JOIN trade_summary t ON LOWER(t.username) = LOWER(u.username)
        LEFT JOIN loops l ON LOWER(l.username) = LOWER(u.username)
        LEFT JOIN shared s ON LOWER(s.username) = LOWER(u.username)
        WHERE u.username IS NOT NULL
          AND (${usernameFilter}::text IS NULL OR LOWER(u.username) = LOWER(${usernameFilter}))
          AND (${statusParam}::text IS NULL OR COALESCE(r.status, 'clear') = ${statusParam})
        ORDER BY "riskScore" DESC, COALESCE(t.last_trade_at, u.created_at) DESC
        LIMIT 120
      `,
      sql`
        WITH loops AS (
          SELECT
            username,
            market_id,
            COUNT(*)::int AS trade_count,
            COUNT(*) FILTER (WHERE side = 'buy')::int AS buy_count,
            COUNT(*) FILTER (WHERE side = 'sell')::int AS sell_count,
            COALESCE(SUM(CASE WHEN side = 'buy' THEN collateral ELSE 0 END), 0)::float AS buy_collateral,
            COALESCE(SUM(CASE WHEN side = 'sell' THEN collateral ELSE 0 END), 0)::float AS sell_collateral,
            COUNT(DISTINCT outcome_index)::int AS outcomes_touched,
            MIN(created_at) AS first_trade_at,
            MAX(created_at) AS last_trade_at,
            MAX(created_at) - MIN(created_at) AS span
          FROM points_trades
          WHERE created_at > NOW() - INTERVAL '14 days'
            AND side IN ('buy', 'sell')
            AND username <> ${PRONOS_TREASURY_USERNAME}
          GROUP BY username, market_id
          HAVING COUNT(*) >= 4
             AND COUNT(*) FILTER (WHERE side = 'buy') > 0
             AND COUNT(*) FILTER (WHERE side = 'sell') > 0
             AND MAX(created_at) - MIN(created_at) <= INTERVAL '6 hours'
        )
        SELECT
          l.username AS "username",
          l.market_id AS "marketId",
          m.question AS "question",
          m.category AS "category",
          m.status AS "status",
          l.trade_count AS "tradeCount",
          l.buy_count AS "buyCount",
          l.sell_count AS "sellCount",
          l.buy_collateral AS "buyCollateral",
          l.sell_collateral AS "sellCollateral",
          l.outcomes_touched AS "outcomesTouched",
          l.first_trade_at AS "firstTradeAt",
          l.last_trade_at AS "lastTradeAt",
          EXTRACT(EPOCH FROM l.span)::int AS "spanSeconds",
          COALESCE(tape.trades, '[]'::jsonb) AS "trades"
        FROM loops l
        JOIN points_markets m ON m.id = l.market_id
        LEFT JOIN LATERAL (
          SELECT JSONB_AGG(
            JSONB_BUILD_OBJECT(
              'id', t.id,
              'side', t.side,
              'outcomeIndex', t.outcome_index,
              'outcomeLabel', COALESCE(m.outcomes ->> (t.outcome_index::int), CONCAT('Outcome ', t.outcome_index::text)),
              'collateral', t.collateral::float,
              'shares', t.shares::float,
              'price', t.price_at_trade::float,
              'createdAt', t.created_at
            )
            ORDER BY t.created_at ASC, t.id ASC
          ) AS trades
          FROM points_trades t
          WHERE LOWER(t.username) = LOWER(l.username)
            AND t.market_id = l.market_id
            AND t.side IN ('buy', 'sell')
            AND t.created_at >= l.first_trade_at
            AND t.created_at <= l.last_trade_at
        ) tape ON TRUE
        WHERE (${usernameFilter}::text IS NULL OR LOWER(l.username) = LOWER(${usernameFilter}))
        ORDER BY l.trade_count DESC, l.last_trade_at DESC
        LIMIT 80
      `,
      sql`
        WITH signals AS (
          SELECT username, 'ip' AS signal_type, ip_hash AS signal_hash, created_at
          FROM points_risk_events
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username IS NOT NULL
            AND username <> ${PRONOS_TREASURY_USERNAME}
            AND ip_hash IS NOT NULL
          UNION ALL
          SELECT username, 'device' AS signal_type, device_hash AS signal_hash, created_at
          FROM points_risk_events
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username IS NOT NULL
            AND username <> ${PRONOS_TREASURY_USERNAME}
            AND device_hash IS NOT NULL
          UNION ALL
          SELECT username, 'session' AS signal_type, session_hash AS signal_hash, created_at
          FROM points_risk_events
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username IS NOT NULL
            AND username <> ${PRONOS_TREASURY_USERNAME}
            AND session_hash IS NOT NULL
        ),
        clusters AS (
          SELECT
            signal_type,
            signal_hash,
            ARRAY_AGG(DISTINCT username ORDER BY username) AS usernames,
            COUNT(DISTINCT username)::int AS user_count,
            COUNT(*)::int AS event_count,
            MIN(created_at) AS first_seen_at,
            MAX(created_at) AS last_seen_at
          FROM signals
          GROUP BY signal_type, signal_hash
          HAVING COUNT(DISTINCT username) > 1
        )
        SELECT
          signal_type AS "signalType",
          LEFT(signal_hash, 12) AS "signalKey",
          usernames AS "usernames",
          user_count AS "userCount",
          event_count AS "eventCount",
          first_seen_at AS "firstSeenAt",
          last_seen_at AS "lastSeenAt"
        FROM clusters
        WHERE (${usernameFilter}::text IS NULL OR ${usernameFilter} = ANY(usernames))
        ORDER BY user_count DESC, event_count DESC, last_seen_at DESC
        LIMIT 60
      `,
      sql`
        WITH signals AS (
          SELECT username, market_id, created_at, 'ip' AS signal_type, ip_hash AS signal_hash
          FROM points_risk_events
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username IS NOT NULL
            AND username <> ${PRONOS_TREASURY_USERNAME}
            AND market_id IS NOT NULL
            AND ip_hash IS NOT NULL
          UNION ALL
          SELECT username, market_id, created_at, 'device' AS signal_type, device_hash AS signal_hash
          FROM points_risk_events
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username IS NOT NULL
            AND username <> ${PRONOS_TREASURY_USERNAME}
            AND market_id IS NOT NULL
            AND device_hash IS NOT NULL
          UNION ALL
          SELECT username, market_id, created_at, 'session' AS signal_type, session_hash AS signal_hash
          FROM points_risk_events
          WHERE created_at > NOW() - INTERVAL '30 days'
            AND username IS NOT NULL
            AND username <> ${PRONOS_TREASURY_USERNAME}
            AND market_id IS NOT NULL
            AND session_hash IS NOT NULL
        ),
        pairs AS (
          SELECT
            a.market_id,
            a.signal_type,
            LEAST(a.username, b.username) AS username_a,
            GREATEST(a.username, b.username) AS username_b,
            LEAST(a.created_at, b.created_at) AS first_seen_at,
            GREATEST(a.created_at, b.created_at) AS last_seen_at
          FROM signals a
          JOIN signals b
            ON a.signal_type = b.signal_type
           AND a.signal_hash = b.signal_hash
           AND a.market_id = b.market_id
           AND a.username < b.username
           AND ABS(EXTRACT(EPOCH FROM (a.created_at - b.created_at))) <= 1800
        )
        SELECT
          p.market_id AS "marketId",
          m.question AS "question",
          p.signal_type AS "signalType",
          p.username_a AS "usernameA",
          p.username_b AS "usernameB",
          COUNT(*)::int AS "overlapCount",
          MIN(p.first_seen_at) AS "firstSeenAt",
          MAX(p.last_seen_at) AS "lastSeenAt"
        FROM pairs p
        JOIN points_markets m ON m.id = p.market_id
        WHERE (${usernameFilter}::text IS NULL OR LOWER(p.username_a) = LOWER(${usernameFilter}) OR LOWER(p.username_b) = LOWER(${usernameFilter}))
        GROUP BY p.market_id, m.question, p.signal_type, p.username_a, p.username_b
        ORDER BY "overlapCount" DESC, "lastSeenAt" DESC
        LIMIT 80
      `,
      sql`
        SELECT
          id AS "id",
          username AS "username",
          flag_type AS "flagType",
          severity AS "severity",
          status AS "status",
          market_id AS "marketId",
          related_usernames AS "relatedUsernames",
          details AS "details",
          created_at AS "createdAt"
        FROM points_risk_flags
        WHERE status = 'open'
          AND (${usernameFilter}::text IS NULL OR LOWER(username) = LOWER(${usernameFilter}))
        ORDER BY severity DESC, created_at DESC
        LIMIT 80
      `,
    ]);

    return res.status(200).json({
      ok: true,
      statuses: RISK_REVIEW_STATUSES,
      accounts: accountRows.map(formatAccountRow),
      rapidLoops: rapidLoopRows.map(formatRapidLoopRow),
      linkedSignals: linkedSignalRows.map(formatLinkedSignalRow),
      sameMarketLinks: sameMarketRows.map(formatSameMarketLinkRow),
      flags: flagRows.map(formatFlagRow),
    });
  } catch (err) {
    console.error('[admin/risk] list failed', { message: err?.message, code: err?.code });
    return res.status(500).json({ error: 'risk_list_failed' });
  }
}

async function handleReview(req, res, adminUsername) {
  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const status = normalizeRiskReviewStatus(body.status);
  const reason = String(body.reason || '').trim().slice(0, 1000);
  if (!username) return res.status(400).json({ error: 'invalid_username' });
  if (!status) return res.status(400).json({ error: 'invalid_status' });

  try {
    const sql = getSchemaSql();
    const users = await sql`
      SELECT username
      FROM points_users
      WHERE LOWER(username) = LOWER(${username})
      LIMIT 1
    `;
    const canonical = users[0]?.username || null;
    if (!canonical) return res.status(404).json({ error: 'user_not_found' });

    const rows = await sql`
      INSERT INTO points_account_reviews (username, status, reason, updated_by)
      VALUES (${canonical}, ${status}, ${reason || null}, ${adminUsername || null})
      ON CONFLICT (username) DO UPDATE
      SET status = EXCLUDED.status,
          reason = EXCLUDED.reason,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
      RETURNING username, status, reason, updated_by AS "updatedBy", updated_at AS "updatedAt", created_at AS "createdAt"
    `;
    return res.status(200).json({ ok: true, review: rows[0] });
  } catch (err) {
    console.error('[admin/risk] review failed', { message: err?.message, code: err?.code });
    return res.status(500).json({ error: 'risk_review_failed' });
  }
}
