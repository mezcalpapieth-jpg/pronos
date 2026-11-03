import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendResponseCookie } from './response-cookies.js';
import { clientIp } from './rate-limit.js';
import { readSessionCookie, verifySessionToken } from './session.js';

const MAX_METADATA_BYTES = 4096;

export const RISK_REVIEW_STATUSES = [
  'clear',
  'watch',
  'phone_required',
  'under_review',
  'ineligible',
];

const RISK_REVIEW_STATUS_SET = new Set(RISK_REVIEW_STATUSES);

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function parseCookieHeader(header) {
  if (!header) return {};
  const out = {};
  for (const pair of String(header).split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function riskSalt() {
  const value = process.env.POINTS_RISK_SALT
    || process.env.POINTS_SESSION_SECRET
    || process.env.MVP_ACCESS_SECRET
    || process.env.CLOB_SESSION_SECRET;
  if (value && String(value).length >= 24) return String(value);
  if (!process.env.VERCEL_ENV) return 'local-dev-points-risk-salt-change-before-prod';
  throw new Error('POINTS_RISK_SALT is not configured');
}

export function hashRiskSignal(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase() === 'unknown') return null;
  return createHmac('sha256', riskSalt()).update(raw).digest('hex');
}

function legacyClientDeviceId(req) {
  const header = firstHeaderValue(req.headers?.['x-pronos-device-id'])
    || firstHeaderValue(req.headers?.['x-device-id']);
  if (header) return String(header).slice(0, 512);
  const cookies = parseCookieHeader(req.headers?.cookie);
  return cookies.pronos_device_id || cookies.points_device_id || null;
}

const DEVICE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
const requestDevices = new WeakMap();

function deviceCookieName() {
  // __Host- forbids Domain/path overrides by sibling subdomains in production.
  return process.env.VERCEL_ENV ? '__Host-pronos_risk_device' : 'pronos_risk_device';
}

function deviceSignature(payload) {
  return createHmac('sha256', riskSalt()).update(`points-risk-device:${payload}`).digest();
}

function readSignedRiskDevice(req, now = Date.now()) {
  const token = parseCookieHeader(req.headers?.cookie)[deviceCookieName()];
  const empty = { id: null, trust: 'none', cookieState: token ? 'invalid' : 'missing', issued: false };
  if (typeof token !== 'string' || token.length > 200) return empty;
  const match = /^(v1\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(\d{10}))\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return empty;
  const issuedAt = Number(match[3]);
  const seconds = Math.floor(now / 1000);
  if (issuedAt > seconds + 60 || issuedAt + DEVICE_MAX_AGE_SEC <= seconds) return empty;
  const actual = Buffer.from(match[4], 'base64url');
  const expected = deviceSignature(match[1]);
  if (actual.length !== expected.length || actual.toString('base64url') !== match[4] || !timingSafeEqual(actual, expected)) return empty;
  return { id: match[2], trust: 'server_verified', cookieState: 'valid', issued: false };
}

// Advisory only: a signed browser identifier can be cleared, copied, or shared.
// Neither request headers nor old JS cookies can select its value.
export function ensurePointsRiskDevice(req, res) {
  if (requestDevices.has(req)) return requestDevices.get(req);
  try {
    const device = readSignedRiskDevice(req);
    if (device.id || !res || res.headersSent) {
      requestDevices.set(req, device);
      return device;
    }
    const id = randomUUID();
    const payload = `v1.${id}.${Math.floor(Date.now() / 1000)}`;
    const token = `${payload}.${deviceSignature(payload).toString('base64url')}`;
    appendResponseCookie(res, [
      `${deviceCookieName()}=${token}`, 'Path=/', `Max-Age=${DEVICE_MAX_AGE_SEC}`,
      'HttpOnly', 'SameSite=Lax', ...(process.env.VERCEL_ENV ? ['Secure'] : []),
    ].join('; '));
    const issued = { id, trust: 'server_issued', cookieState: device.cookieState, issued: true };
    requestDevices.set(req, issued);
    return issued;
  } catch {
    // Capture failures must not block authentication, trading, or claims.
    console.warn('[points-risk] browser cookie unavailable');
    return { id: null, trust: 'none', cookieState: 'unavailable', issued: false };
  }
}

export function sharedRiskSignalScore(signals = []) {
  const weights = { device: 40, session: 40, ip: 10, device_unverified: 5, session_unverified: 5 };
  return signals.reduce((sum, signal) => sum + (weights[signal.signalType] || 0), 0);
}

export function pointsRiskSignals(req) {
  const ip = clientIp(req);
  const userAgent = firstHeaderValue(req.headers?.['user-agent']);
  const device = requestDevices.get(req) || readSignedRiskDevice(req);
  let sessionCookie = null;
  try {
    const raw = readSessionCookie(req);
    if (raw && verifySessionToken(raw)) sessionCookie = raw;
  } catch { /* Invalid/unverifiable session cookies are not identity evidence. */ }
  const clientDevice = legacyClientDeviceId(req);
  return {
    ipHash: hashRiskSignal(ip),
    userAgentHash: hashRiskSignal(userAgent),
    deviceHash: device.id ? hashRiskSignal(`server-device:v1:${device.id}`) : null,
    deviceTrust: device.trust,
    deviceCookieState: device.cookieState,
    clientDeviceHash: hashRiskSignal(clientDevice),
    sessionHash: hashRiskSignal(sessionCookie),
    sessionTrust: sessionCookie ? 'server_verified' : 'none',
  };
}

export function safeRiskMetadata(metadata = {}) {
  const raw = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
  for (const key of ['ip', 'ipAddress', 'userAgent', 'cookie', 'session', 'sessionCookie', 'token', 'deviceId', 'deviceToken', 'clientDeviceId', 'authorization']) {
    delete raw[key];
  }
  let json = '{}';
  try {
    json = JSON.stringify(raw);
  } catch {
    return { dropped: true, reason: 'unserializable' };
  }
  if (Buffer.byteLength(json, 'utf8') <= MAX_METADATA_BYTES) return raw;
  return {
    truncated: true,
    keys: Object.keys(raw).slice(0, 40),
  };
}

function riskEventMetadata(metadata, signals) {
  const provenance = {
    deviceTrust: signals.deviceTrust,
    deviceCookieState: signals.deviceCookieState,
    clientDeviceHash: signals.clientDeviceHash,
    sessionTrust: signals.sessionTrust,
  };
  const safe = { ...safeRiskMetadata(metadata), ...provenance };
  // Oversized action details must not erase the server's trust classification.
  return Buffer.byteLength(JSON.stringify(safe), 'utf8') <= MAX_METADATA_BYTES
    ? safe
    : { truncated: true, ...provenance };
}

export function normalizeRiskReviewStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return RISK_REVIEW_STATUS_SET.has(normalized) ? normalized : null;
}

export async function capturePointsRiskEvent(db, req, {
  username = null,
  accountId = null,
  eventType,
  marketId = null,
  tradeSide = null,
  outcomeIndex = null,
  amount = null,
  shares = null,
  metadata = {},
  res = null,
} = {}) {
  if (!db || !eventType) return;
  try {
    if (res) ensurePointsRiskDevice(req, res);
    const signals = pointsRiskSignals(req);
    const values = {
      username,
      accountHash: hashRiskSignal(accountId),
      eventType,
      marketId: marketId != null && Number.isInteger(Number(marketId)) && Number(marketId) > 0 ? Number(marketId) : null,
      tradeSide,
      outcomeIndex: outcomeIndex != null && Number.isInteger(Number(outcomeIndex)) && Number(outcomeIndex) >= 0 ? Number(outcomeIndex) : null,
      amount: amount != null && Number.isFinite(Number(amount)) ? Number(amount) : null,
      shares: shares != null && Number.isFinite(Number(shares)) ? Number(shares) : null,
      ipHash: signals.ipHash,
      userAgentHash: signals.userAgentHash,
      deviceHash: signals.deviceHash,
      sessionHash: signals.sessionHash,
      metadataJson: JSON.stringify(riskEventMetadata(metadata, signals)),
    };
    if (typeof db === 'function') {
      await db`
        INSERT INTO points_risk_events (
          username, account_hash, event_type, market_id, trade_side,
          outcome_index, amount, shares, ip_hash, user_agent_hash,
          device_hash, session_hash, metadata
        ) VALUES (
          ${values.username}, ${values.accountHash}, ${values.eventType}, ${values.marketId}, ${values.tradeSide},
          ${values.outcomeIndex}, ${values.amount}, ${values.shares}, ${values.ipHash}, ${values.userAgentHash},
          ${values.deviceHash}, ${values.sessionHash}, ${values.metadataJson}::jsonb
        )
      `;
      return;
    }
    if (typeof db.query === 'function') {
      await db.query(
        `INSERT INTO points_risk_events (
           username, account_hash, event_type, market_id, trade_side,
           outcome_index, amount, shares, ip_hash, user_agent_hash,
           device_hash, session_hash, metadata
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8, $9, $10,
           $11, $12, $13::jsonb
         )`,
        [
          values.username,
          values.accountHash,
          values.eventType,
          values.marketId,
          values.tradeSide,
          values.outcomeIndex,
          values.amount,
          values.shares,
          values.ipHash,
          values.userAgentHash,
          values.deviceHash,
          values.sessionHash,
          values.metadataJson,
        ],
      );
    }
  } catch (err) {
    console.warn('[points-risk] capture failed', {
      eventType,
      username,
      message: err?.message,
      code: err?.code,
    });
  }
}
