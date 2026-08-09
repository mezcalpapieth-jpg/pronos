/**
 * Access gate for the video-recording demo page (/points/video).
 *
 * Same signed-cookie design as mvp-access-gate.js, with its own cookie name
 * and password so unlocking one surface never unlocks the other. The shared
 * primitives (constant-time compare, cookie reader) are imported from there
 * rather than duplicated.
 *
 * The page behind this gate renders 100% fabricated data straight from the
 * browser — it never reads or writes the database. The password is here to
 * keep invented Pronos numbers away from people who would mistake them for
 * real ones, not to protect data. That's why the default is baked in instead
 * of failing closed the way the MVP gate does: a missing env var on Vercel
 * would silently kill a recording session, which costs more than the secrecy
 * is worth. Override with VIDEO_ACCESS_PASSWORD.
 *
 * Matching is case-insensitive — the videographer types this by hand, and a
 * capslock slip shouldn't stall a shoot.
 */
import crypto from 'crypto';
import { readCookie, safeEqual } from './mvp-access-gate.js';

export const VIDEO_ACCESS_COOKIE_NAME = 'pronos_video_access';
export const VIDEO_ACCESS_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

const DEFAULT_VIDEO_ACCESS_PASSWORD = 'FABIAN';

export function configuredVideoAccessPassword(env = process.env) {
  return env.VIDEO_ACCESS_PASSWORD || DEFAULT_VIDEO_ACCESS_PASSWORD;
}

export function videoAccessSigningSecret(env = process.env) {
  return env.VIDEO_ACCESS_SECRET
    || env.CLOB_SESSION_SECRET
    || configuredVideoAccessPassword(env);
}

export function signVideoAccessExpiry(exp, env = process.env) {
  return crypto
    .createHmac('sha256', videoAccessSigningSecret(env))
    .update(String(exp))
    .digest('base64url');
}

export function readVideoAccessCookie(headers = {}) {
  return readCookie(headers, VIDEO_ACCESS_COOKIE_NAME);
}

export function verifyVideoAccessCookie(value, { env = process.env, now = Date.now() } = {}) {
  if (!value) return false;
  const [expRaw, sig] = String(value).split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  return safeEqual(sig, signVideoAccessExpiry(expRaw, env));
}

export function buildVideoAccessCookie({ headers = {}, env = process.env, now = Date.now() } = {}) {
  const exp = Math.floor(now / 1000) + VIDEO_ACCESS_COOKIE_TTL_SECONDS;
  const value = `${exp}.${signVideoAccessExpiry(exp, env)}`;
  const secure = headers['x-forwarded-proto'] === 'https' || env.VERCEL === '1';
  const parts = [
    `${VIDEO_ACCESS_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${VIDEO_ACCESS_COOKIE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function verifyVideoAccessPassword(candidate, env = process.env) {
  const expected = configuredVideoAccessPassword(env).trim().toUpperCase();
  const given = String(candidate || '').trim().toUpperCase();
  if (!safeEqual(given, expected)) {
    return { ok: false, status: 401, error: 'Contraseña incorrecta' };
  }
  return { ok: true, status: 200 };
}
