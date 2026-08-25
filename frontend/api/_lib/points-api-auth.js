import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { clientIp } from './rate-limit.js';
import { hashRiskSignal, safeRiskMetadata } from './points-risk.js';

export const PUBLIC_API_HEADERS = [
  'Content-Type',
  'X-PRONOS-API-KEY',
  'X-PRONOS-TIMESTAMP',
  'X-PRONOS-SIGNATURE',
  'Idempotency-Key',
].join(', ');

const MAX_CLOCK_SKEW_MS = 30_000;
const API_KEY_PREFIX = 'pk_pronos';
const API_SECRET_PREFIX = 'pnsec';
const PERMISSIONS = new Set(['READ', 'TRADE']);

function firstHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function headerValue(req, name) {
  const key = String(name || '').toLowerCase();
  return firstHeader(req?.headers?.[key]) || firstHeader(req?.headers?.[name]);
}

export function createApiRequestId() {
  return `req_${randomBytes(12).toString('base64url')}`;
}

export function sendApiError(res, status, code, message, requestId) {
  return res.status(status).json({
    error: {
      code,
      message,
    },
    requestId,
  });
}

export function hashApiCredential(value) {
  return `sha256:${createHash('sha256').update(String(value || '')).digest('hex')}`;
}

function encryptionKey() {
  const material = process.env.POINTS_API_ENCRYPTION_KEY
    || process.env.POINTS_SESSION_SECRET
    || (process.env.VERCEL_ENV ? null : 'local-dev-points-api-secret-change-before-prod');
  if (!material || String(material).length < 16) {
    throw new Error('POINTS_API_ENCRYPTION_KEY not configured');
  }
  return createHash('sha256').update(String(material)).digest();
}

export function encryptApiSecret(secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

function decryptApiSecret(ciphertext) {
  const parts = String(ciphertext || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('invalid_api_secret_ciphertext');
  }
  const [, ivText, tagText, cipherText] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(ivText, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function normalizeApiPermissions(value, fallback = ['READ']) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = raw.split(',');
    }
  }
  const permissions = Array.isArray(raw)
    ? raw.map(item => String(item || '').trim().toUpperCase()).filter(item => PERMISSIONS.has(item))
    : [];
  const unique = [...new Set(permissions)];
  if (unique.length === 0) return [...fallback];
  if (unique.includes('TRADE') && !unique.includes('READ')) unique.unshift('READ');
  return unique;
}

export function createApiCredentials({ prefix = API_KEY_PREFIX } = {}) {
  const apiKey = `${prefix}_${randomBytes(24).toString('base64url')}`;
  const apiSecret = `${API_SECRET_PREFIX}_${randomBytes(32).toString('base64url')}`;
  return {
    apiKey,
    apiSecret,
    keyPrefix: apiKey.slice(0, 22),
    keyHash: hashApiCredential(apiKey),
    secretHash: hashApiCredential(apiSecret),
    secretCiphertext: encryptApiSecret(apiSecret),
  };
}

export function apiRequestPath(req) {
  const raw = String(req?.url || '/');
  const parsed = /^https?:\/\//i.test(raw)
    ? new URL(raw)
    : new URL(raw, 'https://pronos.local');
  return `${parsed.pathname}${parsed.search}`;
}

function jsonBodyError() {
  const err = new Error('invalid_json_body');
  err.status = 400;
  err.code = 'invalid_json_body';
  return err;
}

function isJsonRequest(req) {
  const contentType = String(headerValue(req, 'content-type') || '').toLowerCase();
  return contentType.includes('application/json') || contentType.includes('+json');
}

function parseRawJsonBody(req, raw) {
  if (!raw || !isJsonRequest(req)) return;
  try {
    req.body = JSON.parse(raw);
  } catch {
    throw jsonBodyError();
  }
}

export async function readRawRequestBody(req, { maxBytes = 64 * 1024 } = {}) {
  if (!req || req.method === 'GET' || req.method === 'HEAD') return '';
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) {
    req.rawBody = req.rawBody.toString('utf8');
    return req.rawBody;
  }

  if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : req.body;
    req.rawBody = raw;
    parseRawJsonBody(req, raw);
    return raw;
  }

  if (req.body && typeof req.body === 'object') {
    req.rawBody = JSON.stringify(req.body);
    return req.rawBody;
  }

  if (typeof req.on !== 'function') {
    req.rawBody = '';
    return '';
  }

  const chunks = [];
  let size = 0;
  const raw = await new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const err = new Error('payload_too_large');
        err.status = 413;
        err.code = 'payload_too_large';
        reject(err);
        req.destroy?.();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  req.rawBody = raw;
  parseRawJsonBody(req, raw);
  if (req.body == null) req.body = raw;
  return raw;
}

export function canonicalRequestBody(req) {
  if (!req || req.method === 'GET' || req.method === 'HEAD') return '';
  if (typeof req.rawBody === 'string') return req.rawBody;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  if (req.body == null) return '';
  return JSON.stringify(req.body);
}

export function signApiRequest({ timestamp, method, path, body, secret }) {
  const payload = `${timestamp}${String(method || '').toUpperCase()}${path}${body || ''}`;
  return createHmac('sha256', String(secret || '')).update(payload).digest('hex');
}

function signaturesMatch(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function parseTimestampMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

export function stableApiRequestHash(req) {
  const method = String(req?.method || '').toUpperCase();
  const path = apiRequestPath(req);
  const body = canonicalRequestBody(req);
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('hex');
}

export async function authenticatePointsApiRequest(sql, req, {
  requiredPermission = 'READ',
  requestId = null,
} = {}) {
  const apiKey = String(headerValue(req, 'x-pronos-api-key') || '').trim();
  const timestamp = String(headerValue(req, 'x-pronos-timestamp') || '').trim();
  const signature = String(headerValue(req, 'x-pronos-signature') || '').trim().toLowerCase();

  if (!apiKey || !timestamp || !signature) {
    const err = new Error('missing_api_auth_headers');
    err.status = 401;
    err.code = 'missing_api_auth_headers';
    throw err;
  }

  const timestampMs = parseTimestampMs(timestamp);
  if (!timestampMs || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    const err = new Error('stale_api_timestamp');
    err.status = 401;
    err.code = 'stale_api_timestamp';
    throw err;
  }

  const rows = await sql`
    SELECT id, username, user_sub, key_prefix, secret_ciphertext, permissions
      FROM points_api_keys
     WHERE key_hash = ${hashApiCredential(apiKey)}
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1
  `;
  const key = rows[0];
  if (!key) {
    const err = new Error('invalid_api_key');
    err.status = 401;
    err.code = 'invalid_api_key';
    throw err;
  }

  const secret = decryptApiSecret(key.secret_ciphertext);
  const expected = signApiRequest({
    timestamp,
    method: req.method,
    path: apiRequestPath(req),
    body: canonicalRequestBody(req),
    secret,
  });
  if (!signaturesMatch(signature, expected)) {
    const err = new Error('invalid_api_signature');
    err.status = 401;
    err.code = 'invalid_api_signature';
    throw err;
  }

  const permissions = normalizeApiPermissions(key.permissions, []);
  const required = String(requiredPermission || 'READ').toUpperCase();
  if (required && !permissions.includes(required)) {
    const err = new Error('missing_api_permission');
    err.status = 403;
    err.code = 'missing_api_permission';
    throw err;
  }

  const ipHash = hashRiskSignal(clientIp(req));
  await sql`
    UPDATE points_api_keys
       SET last_used_at = NOW(),
           last_used_ip_hash = ${ipHash}
     WHERE id = ${key.id}
       AND (
         last_used_at IS NULL
         OR last_used_at < NOW() - INTERVAL '1 minute'
         OR last_used_ip_hash IS DISTINCT FROM ${ipHash}
       )
  `;

  return {
    apiKeyId: Number(key.id),
    username: key.username,
    userSub: key.user_sub || null,
    keyPrefix: key.key_prefix,
    permissions,
    requestId,
  };
}

export async function recordApiRequest(sql, {
  requestId,
  apiKeyId = null,
  username = null,
  method,
  endpoint,
  result,
  statusCode,
  errorCode = null,
  req = null,
  metadata = {},
} = {}) {
  if (!sql || !requestId) return;
  try {
    await sql`
      INSERT INTO points_api_request_logs (
        request_id, api_key_id, username, method, endpoint, result,
        status_code, error_code, ip_hash, user_agent_hash, metadata
      ) VALUES (
        ${requestId}, ${apiKeyId}, ${username}, ${String(method || '').toUpperCase()},
        ${endpoint || 'unknown'}, ${result || 'unknown'}, ${statusCode || null}, ${errorCode},
        ${req ? hashRiskSignal(clientIp(req)) : null},
        ${req ? hashRiskSignal(headerValue(req, 'user-agent')) : null},
        ${JSON.stringify(safeRiskMetadata(metadata))}::jsonb
      )
    `;
  } catch (err) {
    console.warn('[points-api] request log failed', {
      requestId,
      message: err?.message,
      code: err?.code,
    });
  }
}
