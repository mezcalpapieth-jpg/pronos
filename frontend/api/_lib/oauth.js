/**
 * OAuth 2.0 helpers for social-linking flows.
 *
 * Scope: this module handles the state/PKCE machinery generically
 * across X / Instagram / TikTok. Each provider's endpoint does its
 * own token-exchange and profile fetch since the response shapes
 * differ — but state, cookie signing, and PKCE are identical.
 *
 * Security model:
 *   - `state` is a random 32-byte token the authorize URL carries
 *     and the callback checks, protecting against CSRF
 *   - PKCE (S256) stops an attacker who intercepts the auth code
 *     from exchanging it without the `code_verifier`
 *   - The transient payload {state, verifier, username, provider}
 *     rides in an HttpOnly signed cookie keyed by provider —
 *     separate cookie per provider so concurrent links don't clash
 *   - Cookie lifetime is 10 minutes; expires well before the user
 *     could come back days later with a stale code
 */

import { createHmac, randomBytes, createHash, timingSafeEqual } from 'crypto';

const COOKIE_PREFIX = 'pronos_oauth_';
const COOKIE_MAX_AGE_SEC = 10 * 60; // 10 min — long enough for the user to
                                    // complete the provider's consent screen

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
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

function sign(payload) {
  return createHmac('sha256', getSecret()).update(payload).digest();
}

function verifySig(payload, sigBuf) {
  const expected = sign(payload);
  if (expected.length !== sigBuf.length) return false;
  try { return timingSafeEqual(expected, sigBuf); } catch { return false; }
}

// ── PKCE helpers ────────────────────────────────────────────────────────

export function generateCodeVerifier() {
  // RFC 7636: 43-128 chars, URL-safe. 32 random bytes → 43 base64url chars.
  return b64urlEncode(randomBytes(32));
}

export function codeChallenge(verifier) {
  const hash = createHash('sha256').update(verifier).digest();
  return b64urlEncode(hash);
}

export function generateState() {
  return b64urlEncode(randomBytes(24));
}

// ── Cookie (signed) ─────────────────────────────────────────────────────
// Payload shape: { state, verifier, username, provider, returnTo }.

export function setOAuthCookie(res, provider, payload) {
  const body = b64urlEncode(Buffer.from(JSON.stringify(payload)));
  const sig  = b64urlEncode(sign(body));
  const value = `${body}.${sig}`;
  const inProd = process.env.VERCEL_ENV === 'production';
  const cookie = [
    `${COOKIE_PREFIX}${provider}=${value}`,
    `Max-Age=${COOKIE_MAX_AGE_SEC}`,
    'Path=/',
    'HttpOnly',
    `SameSite=Lax`,
    inProd ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  const existing = res.getHeader('Set-Cookie');
  const next = Array.isArray(existing) ? [...existing, cookie] : existing ? [existing, cookie] : cookie;
  res.setHeader('Set-Cookie', next);
}

export function readOAuthCookie(req, provider) {
  const raw = (req.headers.cookie || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith(`${COOKIE_PREFIX}${provider}=`));
  if (!raw) return null;
  const [, value] = raw.split('=');
  const [body, sig] = (value || '').split('.');
  if (!body || !sig) return null;
  if (!verifySig(body, Buffer.from(sig, 'base64url'))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function clearOAuthCookie(res, provider) {
  const inProd = process.env.VERCEL_ENV === 'production';
  const cookie = [
    `${COOKIE_PREFIX}${provider}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    inProd ? 'Secure' : '',
  ].filter(Boolean).join('; ');
  const existing = res.getHeader('Set-Cookie');
  const next = Array.isArray(existing) ? [...existing, cookie] : existing ? [existing, cookie] : cookie;
  res.setHeader('Set-Cookie', next);
}

// ── URL utility ─────────────────────────────────────────────────────────

/**
 * Resolve our public callback URL for `provider`. Prefers an explicit
 * override env var; falls back to the Vercel-assigned host in prod/preview.
 * In local dev the env var is required (localhost:3000 won't work for X
 * anyway — it needs a public URL).
 */
export function resolveCallbackUrl(provider) {
  const override = process.env[`OAUTH_${provider.toUpperCase()}_CALLBACK_URL`];
  if (override) return override;
  const host = process.env.VERCEL_URL;
  if (!host) {
    throw new Error(`OAUTH_${provider.toUpperCase()}_CALLBACK_URL not set and VERCEL_URL missing`);
  }
  const scheme = host.startsWith('http') ? '' : 'https://';
  return `${scheme}${host}/api/social/${provider}/callback`;
}

/**
 * Build a redirect response to the caller's original returnTo (or /earn).
 */
export function redirectToReturn(res, returnTo, status = 'linked', provider = '') {
  const base = returnTo || '/earn';
  const sep = base.includes('?') ? '&' : '?';
  const url = `${base}${sep}${status}=${encodeURIComponent(provider)}`;
  res.setHeader('Location', url);
  res.status(302).end();
}
