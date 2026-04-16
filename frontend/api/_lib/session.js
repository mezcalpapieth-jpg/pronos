/**
 * Session cookie layer for the points app.
 *
 * Why this exists:
 *   We can't call Turnkey on every API request — that would add a ~200ms
 *   network round-trip to every /api/points/* call and rack up Turnkey
 *   usage. Instead, the auth endpoints (verify-otp, username) establish
 *   a session cookie that server-side code can check cheaply.
 *
 * Model:
 *   The cookie is an HMAC-signed JWT-ish token with:
 *     { sub: suborgId, email, username, iat, exp }
 *   We sign with POINTS_SESSION_SECRET (separate from any other secret
 *   in the repo so rotating one doesn't invalidate the others).
 *
 *   Lifetime: 30 days. The cookie is HttpOnly, Secure in prod, SameSite=Lax
 *   so it works for same-site POSTs but isn't sent cross-site.
 *
 *   Rotation: the cookie is re-issued on every successful `readSession`
 *   that's older than ROTATE_AFTER so the sliding window stays fresh.
 */

import { createHmac, timingSafeEqual, webcrypto } from 'crypto';

const COOKIE_NAME = 'pronos_points_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30;        // 30 days
const ROTATE_AFTER_SEC = 60 * 60 * 24;        // re-issue once per day

// ─── Encoding helpers ───────────────────────────────────────────────────────
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}
function b64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

function getSecret() {
  const s = process.env.POINTS_SESSION_SECRET
        || process.env.MVP_ACCESS_SECRET
        || process.env.CLOB_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('POINTS_SESSION_SECRET not configured');
  }
  return s;
}

// ─── HMAC ───────────────────────────────────────────────────────────────────
function sign(payload) {
  return createHmac('sha256', getSecret()).update(payload).digest();
}

function verifySig(payload, sigBuf) {
  const expected = sign(payload);
  if (expected.length !== sigBuf.length) return false;
  try {
    return timingSafeEqual(expected, sigBuf);
  } catch {
    return false;
  }
}

// ─── Token format: <payloadB64url>.<sigB64url> ─────────────────────────────
export function createSessionToken({ suborgId, email, username }) {
  if (!suborgId) throw new Error('createSessionToken: suborgId required');
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: suborgId,
    email: email ? email.toLowerCase() : null,
    username: username || null,
    iat: now,
    exp: now + MAX_AGE_SEC,
  };
  const payload = b64urlEncode(JSON.stringify(claims));
  const sig = b64urlEncode(sign(payload));
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const sigBuf = b64urlDecode(sig);
  if (!verifySig(payload, sigBuf)) return null;
  let claims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!claims.exp || claims.exp < now) return null;
  return claims;
}

// ─── Cookie helpers for Vercel serverless ───────────────────────────────────
export function setSessionCookie(res, token) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${MAX_AGE_SEC}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (process.env.VERCEL_ENV) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
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
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function readSessionCookie(req) {
  const cookies = parseCookieHeader(req.headers?.cookie);
  return cookies[COOKIE_NAME] || null;
}

/**
 * Parse and verify the session cookie on an incoming request.
 * Returns the claims object if valid, or null if missing/invalid/expired.
 * On older-but-valid sessions, sets a refreshed cookie on the response.
 */
export function readSession(req, res) {
  const raw = readSessionCookie(req);
  if (!raw) return null;
  const claims = verifySessionToken(raw);
  if (!claims) {
    // Stale / tampered cookie — clear it so the client stops sending it.
    if (res) clearSessionCookie(res);
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (res && claims.iat && (now - claims.iat) > ROTATE_AFTER_SEC) {
    const refreshed = createSessionToken({
      suborgId: claims.sub,
      email: claims.email,
      username: claims.username,
    });
    setSessionCookie(res, refreshed);
  }
  return claims;
}

/**
 * Guard helper: require a logged-in session. Sends 401 and returns null
 * if the caller isn't authenticated; returns the claims object otherwise.
 *
 * Usage:
 *   const session = requireSession(req, res);
 *   if (!session) return;
 */
export function requireSession(req, res) {
  const claims = readSession(req, res);
  if (!claims) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  return claims;
}

/**
 * Produce a fresh random string — useful for CSRF or nonce purposes in
 * future phases.
 */
export function randomToken(bytes = 16) {
  const buf = new Uint8Array(bytes);
  (globalThis.crypto || webcrypto).getRandomValues(buf);
  return b64urlEncode(buf);
}
