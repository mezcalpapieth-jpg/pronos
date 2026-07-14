import { createHmac, randomBytes } from 'crypto';
import { clientIp } from './rate-limit.js';

const COOKIE_NAME = 'pronos_deck_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 14;

function getSecret() {
  const secret = process.env.DECK_ACCESS_SECRET
    || process.env.POINTS_SESSION_SECRET
    || (process.env.VERCEL_ENV ? null : process.env.MVP_ACCESS_SECRET);
  if (!secret || secret.length < 16) {
    throw new Error('DECK_ACCESS_SECRET or POINTS_SESSION_SECRET not configured');
  }
  return secret;
}

export function normalizeDeckEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function normalizeDeckCode(code) {
  return String(code || '').trim();
}

export function hashDeckCode(code) {
  const normalized = normalizeDeckCode(code);
  return createHmac('sha256', getSecret()).update(`deck-code:${normalized}`).digest('hex');
}

export function hashDeckIp(req) {
  const ip = clientIp(req);
  return createHmac('sha256', getSecret()).update(`deck-ip:${ip}`).digest('hex').slice(0, 32);
}

export function newDeckSessionId() {
  return randomBytes(18).toString('base64url');
}

export function generateDeckCode() {
  return `PRONOS-${randomBytes(5).toString('base64url').toUpperCase()}`;
}

export function setDeckSessionCookie(res, sessionId) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.VERCEL_ENV) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearDeckSessionCookie(res) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.VERCEL_ENV) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function parseCookieHeader(header) {
  if (!header) return {};
  const out = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function readDeckSessionCookie(req) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

export async function readDeckSession(req, res, sql) {
  const sessionId = readDeckSessionCookie(req);
  if (!sessionId) return null;
  const rows = await sql`
    SELECT
      ds.id,
      ds.invite_id,
      ds.viewer_email,
      ds.deck_language,
      ds.started_at,
      ds.last_seen_at,
      di.label AS invite_label,
      di.email_hint AS invite_email_hint,
      di.active AS invite_active,
      di.revoked_at AS invite_revoked_at
    FROM deck_sessions ds
    JOIN deck_invites di ON di.id = ds.invite_id
    WHERE ds.id = ${sessionId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || !row.invite_active || row.invite_revoked_at) {
    if (res) clearDeckSessionCookie(res);
    return null;
  }
  return row;
}

export function publicDeckSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    viewerEmail: row.viewer_email,
    language: row.deck_language || 'en',
    inviteId: row.invite_id,
    inviteLabel: row.invite_label,
    inviteEmailHint: row.invite_email_hint,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
  };
}
