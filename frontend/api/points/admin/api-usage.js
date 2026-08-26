/**
 * GET  /api/points/admin/api-usage
 * POST /api/points/admin/api-usage
 *
 * Admin-only observability for public API keys. This endpoint exposes
 * usage shape and recent request metadata, but never credential hashes,
 * encrypted secrets, raw IPs, or raw user agents.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';

let readSql;
let writeSql;
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

function getWriteSql() {
  if (!writeSql) {
    if (!process.env.DATABASE_URL) {
      const err = new Error('DATABASE_URL not configured');
      err.status = 500;
      throw err;
    }
    writeSql = neon(process.env.DATABASE_URL);
  }
  return writeSql;
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

function toNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeUsername(value) {
  const username = String(value || '').toLowerCase().trim().replace(/^@/, '');
  return USERNAME_RE.test(username) ? username : null;
}

function normalizeBlockReason(value) {
  const reason = String(value || '').trim().replace(/\s+/g, ' ');
  return reason.slice(0, 240);
}

function formatKeyUsageRow(row) {
  return {
    id: toNumber(row.id),
    username: row.username || null,
    name: row.name || '',
    keyPrefix: row.key_prefix || '',
    permissions: parseJson(row.permissions, []),
    createdAt: row.created_at || null,
    lastUsedAt: row.last_used_at || null,
    revokedAt: row.revoked_at || null,
    expiresAt: row.expires_at || null,
    apiBlockedAt: row.api_blocked_at || null,
    apiBlockedBy: row.api_blocked_by || null,
    apiBlockReason: row.api_block_reason || null,
    requestsTotal: toNumber(row.requests_total),
    requests24h: toNumber(row.requests_24h),
    requests7d: toNumber(row.requests_7d),
    tradeRequests24h: toNumber(row.trade_requests_24h),
    errors24h: toNumber(row.errors_24h),
    distinctIpHashes7d: toNumber(row.distinct_ip_hashes_7d),
    lastRequestAt: row.last_request_at || null,
    lastEndpoint: row.last_endpoint || null,
    lastResult: row.last_result || null,
  };
}

function formatRecentRequestRow(row) {
  return {
    requestId: row.request_id || null,
    apiKeyId: row.api_key_id == null ? null : toNumber(row.api_key_id),
    username: row.username || null,
    keyPrefix: row.key_prefix || null,
    keyName: row.key_name || null,
    method: row.method || '',
    endpoint: row.endpoint || '',
    result: row.result || '',
    statusCode: row.status_code == null ? null : toNumber(row.status_code),
    errorCode: row.error_code || null,
    metadata: parseJson(row.metadata, {}),
    createdAt: row.created_at || null,
  };
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  try {
    await ensurePointsSchema(getSchemaSql());
    if (req.method === 'POST') return await handleMutation(req, res, admin.username);
    const sql = getReadSql();

    const [
      keySummaryRows,
      requestSummaryRows,
      keyRows,
      recentRows,
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*)::int AS total_keys,
          COUNT(*) FILTER (WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW()))::int AS active_keys,
          COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked_keys,
          COUNT(*) FILTER (WHERE revoked_at IS NULL AND expires_at <= NOW())::int AS expired_keys
        FROM points_api_keys
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS requests_24h,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS requests_7d,
          COUNT(*) FILTER (
            WHERE created_at > NOW() - INTERVAL '24 hours'
              AND (result = 'error' OR status_code >= 400)
          )::int AS errors_24h,
          COUNT(*) FILTER (
            WHERE created_at > NOW() - INTERVAL '24 hours'
              AND endpoint LIKE '/api/v1/trades%'
          )::int AS trade_requests_24h,
          COUNT(DISTINCT username) FILTER (
            WHERE created_at > NOW() - INTERVAL '7 days'
              AND username IS NOT NULL
          )::int AS distinct_users_7d
        FROM points_api_request_logs
      `,
      sql`
        SELECT
          k.id,
          k.username,
          k.name,
          k.key_prefix,
          k.permissions,
          k.created_at,
          k.last_used_at,
          k.revoked_at,
          k.expires_at,
          u.api_blocked_at,
          u.api_blocked_by,
          u.api_block_reason,
          COUNT(l.id)::int AS requests_total,
          COUNT(l.id) FILTER (WHERE l.created_at > NOW() - INTERVAL '24 hours')::int AS requests_24h,
          COUNT(l.id) FILTER (WHERE l.created_at > NOW() - INTERVAL '7 days')::int AS requests_7d,
          COUNT(l.id) FILTER (
            WHERE l.created_at > NOW() - INTERVAL '24 hours'
              AND l.endpoint LIKE '/api/v1/trades%'
          )::int AS trade_requests_24h,
          COUNT(l.id) FILTER (
            WHERE l.created_at > NOW() - INTERVAL '24 hours'
              AND (l.result = 'error' OR l.status_code >= 400)
          )::int AS errors_24h,
          COUNT(DISTINCT l.ip_hash) FILTER (
            WHERE l.created_at > NOW() - INTERVAL '7 days'
              AND l.ip_hash IS NOT NULL
          )::int AS distinct_ip_hashes_7d,
          MAX(l.created_at) AS last_request_at,
          (ARRAY_AGG(l.endpoint ORDER BY l.created_at DESC) FILTER (WHERE l.id IS NOT NULL))[1] AS last_endpoint,
          (ARRAY_AGG(l.result ORDER BY l.created_at DESC) FILTER (WHERE l.id IS NOT NULL))[1] AS last_result
        FROM points_api_keys k
        LEFT JOIN points_api_request_logs l ON l.api_key_id = k.id
        LEFT JOIN points_users u ON LOWER(u.username) = LOWER(k.username)
        GROUP BY k.id, k.username, k.name, k.key_prefix, k.permissions, k.created_at,
                 k.last_used_at, k.revoked_at, k.expires_at,
                 u.api_blocked_at, u.api_blocked_by, u.api_block_reason
        ORDER BY last_request_at DESC NULLS LAST, k.created_at DESC
        LIMIT 100
      `,
      sql`
        SELECT
          l.request_id,
          l.api_key_id,
          COALESCE(l.username, k.username) AS username,
          k.key_prefix,
          k.name AS key_name,
          l.method,
          l.endpoint,
          l.result,
          l.status_code,
          l.error_code,
          l.metadata,
          l.created_at
        FROM points_api_request_logs l
        LEFT JOIN points_api_keys k ON k.id = l.api_key_id
        ORDER BY l.created_at DESC
        LIMIT 120
      `,
    ]);

    const keySummary = keySummaryRows[0] || {};
    const requestSummary = requestSummaryRows[0] || {};
    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalKeys: toNumber(keySummary.total_keys),
        activeKeys: toNumber(keySummary.active_keys),
        revokedKeys: toNumber(keySummary.revoked_keys),
        expiredKeys: toNumber(keySummary.expired_keys),
        requests24h: toNumber(requestSummary.requests_24h),
        requests7d: toNumber(requestSummary.requests_7d),
        errors24h: toNumber(requestSummary.errors_24h),
        tradeRequests24h: toNumber(requestSummary.trade_requests_24h),
        distinctUsers7d: toNumber(requestSummary.distinct_users_7d),
      },
      keys: keyRows.map(formatKeyUsageRow),
      recent: recentRows.map(formatRecentRequestRow),
    });
  } catch (e) {
    console.error('[points/admin/api-usage] failed', { message: e?.message, code: e?.code });
    return res.status(e?.status || 500).json({ error: 'api_usage_failed' });
  }
}

async function handleMutation(req, res, adminUsername) {
  const sql = getWriteSql();
  const action = String(req.body?.action || '').trim();
  const username = normalizeUsername(req.body?.username);
  if (!username) return res.status(400).json({ error: 'invalid_username' });

  if (action === 'block_user_api') {
    const reason = normalizeBlockReason(req.body?.reason)
      || 'Bloqueado desde admin API';
    const userRows = await sql`
      UPDATE points_users
         SET api_blocked_at = COALESCE(api_blocked_at, NOW()),
             api_blocked_by = ${adminUsername || 'admin'},
             api_block_reason = ${reason}
       WHERE LOWER(username) = LOWER(${username})
      RETURNING username, api_blocked_at, api_blocked_by, api_block_reason
    `;
    if (!userRows[0]) return res.status(404).json({ error: 'user_not_found' });

    const revokedRows = await sql`
      UPDATE points_api_keys
         SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE LOWER(username) = LOWER(${username})
         AND revoked_at IS NULL
      RETURNING id
    `;
    return res.status(200).json({
      ok: true,
      action,
      revokedKeys: revokedRows.length,
      user: {
        username: userRows[0].username,
        apiBlockedAt: userRows[0].api_blocked_at || null,
        apiBlockedBy: userRows[0].api_blocked_by || null,
        apiBlockReason: userRows[0].api_block_reason || null,
      },
    });
  }

  if (action === 'unblock_user_api') {
    const userRows = await sql`
      UPDATE points_users
         SET api_blocked_at = NULL,
             api_blocked_by = NULL,
             api_block_reason = NULL
       WHERE LOWER(username) = LOWER(${username})
      RETURNING username, api_blocked_at, api_blocked_by, api_block_reason
    `;
    if (!userRows[0]) return res.status(404).json({ error: 'user_not_found' });
    return res.status(200).json({
      ok: true,
      action,
      revokedKeys: 0,
      user: {
        username: userRows[0].username,
        apiBlockedAt: null,
        apiBlockedBy: null,
        apiBlockReason: null,
      },
    });
  }

  return res.status(400).json({ error: 'invalid_action' });
}
