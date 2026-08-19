import { createHmac } from 'node:crypto';
import { clientIp } from './rate-limit.js';
import { readSessionCookie } from './session.js';

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

function safeDeviceId(req) {
  const header = firstHeaderValue(req.headers?.['x-pronos-device-id'])
    || firstHeaderValue(req.headers?.['x-device-id']);
  if (header) return String(header).slice(0, 512);
  const cookies = parseCookieHeader(req.headers?.cookie);
  return cookies.pronos_device_id || cookies.points_device_id || null;
}

export function pointsRiskSignals(req) {
  const ip = clientIp(req);
  const userAgent = firstHeaderValue(req.headers?.['user-agent']);
  const device = safeDeviceId(req);
  const sessionCookie = readSessionCookie(req);
  return {
    ipHash: hashRiskSignal(ip),
    userAgentHash: hashRiskSignal(userAgent),
    deviceHash: hashRiskSignal(device),
    sessionHash: hashRiskSignal(sessionCookie),
  };
}

export function safeRiskMetadata(metadata = {}) {
  const raw = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
  for (const key of ['ip', 'ipAddress', 'userAgent', 'cookie', 'session', 'sessionCookie', 'token']) {
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
} = {}) {
  if (!db || !eventType) return;
  try {
    const signals = pointsRiskSignals(req);
    const values = {
      username,
      accountHash: hashRiskSignal(accountId),
      eventType,
      marketId: Number.isInteger(Number(marketId)) ? Number(marketId) : null,
      tradeSide,
      outcomeIndex: Number.isInteger(Number(outcomeIndex)) ? Number(outcomeIndex) : null,
      amount: Number.isFinite(Number(amount)) ? Number(amount) : null,
      shares: Number.isFinite(Number(shares)) ? Number(shares) : null,
      ipHash: signals.ipHash,
      userAgentHash: signals.userAgentHash,
      deviceHash: signals.deviceHash,
      sessionHash: signals.sessionHash,
      metadataJson: JSON.stringify(safeRiskMetadata(metadata)),
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
