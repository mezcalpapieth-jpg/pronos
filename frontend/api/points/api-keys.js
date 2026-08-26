/**
 * Session-authenticated API key management for the points app.
 *
 * The raw API secret is returned only once, in the POST response. The
 * database stores a key hash plus an encrypted signing secret for HMAC
 * verification on public /api/v1 routes.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { clientIp, rateLimit } from '../_lib/rate-limit.js';
import { hashRiskSignal } from '../_lib/points-risk.js';
import {
  createApiCredentials,
  normalizeApiPermissions,
} from '../_lib/points-api-auth.js';

let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

function publicKeyRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    keyPrefix: row.key_prefix,
    permissions: normalizeApiPermissions(row.permissions, []),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
  };
}

function publicAccessState(row = {}) {
  const reviewStatus = row.review_status || 'clear';
  return {
    apiBlockedAt: row.api_blocked_at || null,
    reviewStatus,
    phoneRequired: reviewStatus === 'phone_required',
  };
}

async function getAccountAccessState(sql, session) {
  const rows = await sql`
    SELECT
      u.api_blocked_at,
      COALESCE(r.status, 'clear') AS review_status
    FROM points_users u
    LEFT JOIN points_account_reviews r ON LOWER(r.username) = LOWER(u.username)
    WHERE u.turnkey_sub_org_id = ${session.sub || null}
       OR LOWER(u.username) = LOWER(${session.username})
    ORDER BY CASE WHEN u.turnkey_sub_org_id = ${session.sub || null} THEN 0 ELSE 1 END
    LIMIT 1
  `;
  return publicAccessState(rows[0] || {});
}

function normalizeName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 80) return null;
  return name;
}

function normalizeExpiresAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date <= new Date()) return 'invalid';
  return date.toISOString();
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    methods: 'GET, POST, DELETE, OPTIONS',
    credentials: true,
  });
  if (cors) return cors;
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  try {
    const sql = getSql();
    await ensurePointsSchema(getSchemaSql());

    if (req.method === 'GET') {
      const [rows, access] = await Promise.all([
        sql`
          SELECT id, name, key_prefix, permissions, created_at, last_used_at, revoked_at, expires_at
            FROM points_api_keys
           WHERE username = ${session.username}
           ORDER BY created_at DESC, id DESC
           LIMIT 50
        `,
        getAccountAccessState(sql, session),
      ]);
      return res.status(200).json({ keys: rows.map(publicKeyRow), access });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.body?.id || req.query?.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_key_id' });
      const rows = await sql`
        UPDATE points_api_keys
           SET revoked_at = COALESCE(revoked_at, NOW())
         WHERE id = ${id}
           AND username = ${session.username}
        RETURNING id, name, key_prefix, permissions, created_at, last_used_at, revoked_at, expires_at
      `;
      if (!rows[0]) return res.status(404).json({ error: 'api_key_not_found' });
      return res.status(200).json({ ok: true, key: publicKeyRow(rows[0]) });
    }

    const limited = rateLimit(req, res, {
      key: `points-api-key-create:${session.username}:${clientIp(req)}`,
      limit: 6,
      windowMs: 60 * 60_000,
    });
    if (limited) return;

    const access = await getAccountAccessState(sql, session);
    if (access.apiBlockedAt) {
      return res.status(403).json({
        error: 'api_access_blocked',
        detail: 'API access has been blocked for this account.',
      });
    }

    const name = normalizeName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'invalid_name' });

    const permissions = normalizeApiPermissions(req.body?.permissions || ['READ'], ['READ']);
    const expiresAt = normalizeExpiresAt(req.body?.expiresAt);
    if (expiresAt === 'invalid') return res.status(400).json({ error: 'invalid_expires_at' });

    const credentials = createApiCredentials();
    const rows = await sql`
      INSERT INTO points_api_keys (
        username, user_sub, name, key_prefix, key_hash, secret_hash, secret_ciphertext,
        permissions, expires_at, created_from_ip_hash
      ) VALUES (
        ${session.username}, ${session.sub || null}, ${name}, ${credentials.keyPrefix},
        ${credentials.keyHash}, ${credentials.secretHash}, ${credentials.secretCiphertext},
        ${JSON.stringify(permissions)}::jsonb, ${expiresAt}, ${hashRiskSignal(clientIp(req))}
      )
      RETURNING id, name, key_prefix, permissions, created_at, last_used_at, revoked_at, expires_at
    `;

    return res.status(201).json({
      ok: true,
      key: publicKeyRow(rows[0]),
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
    });
  } catch (e) {
    console.error('[points/api-keys] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'api_keys_failed' });
  }
}
