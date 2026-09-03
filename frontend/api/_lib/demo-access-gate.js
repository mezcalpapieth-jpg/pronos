/**
 * Access gate for the presentation demo page (/points-demo).
 *
 * Same signed-cookie design as video-access-gate.js, with its own cookie name
 * and password so unlocking one surface never unlocks the other — the video
 * demo password is shared with a videographer, and the conference password is
 * handed out on stage. Neither should open the other's door.
 *
 * Like the video gate, everything behind this renders fabricated data from the
 * browser and never touches the database, so the default is baked in rather
 * than failing closed: a missing env var killing a live stage demo costs more
 * than the secrecy is worth. Override with POINTS_DEMO_PASSWORD.
 *
 * Matching is case-insensitive — this gets typed by hand from a slide, and a
 * capslock slip shouldn't stall a presentation.
 */
import crypto from 'crypto';
import { readCookie, safeEqual } from './mvp-access-gate.js';

export const DEMO_ACCESS_COOKIE_NAME = 'pronos_demo_access';
export const DEMO_ACCESS_COOKIE_TTL_SECONDS = 30 * 24 * 60 * 60;

const DEFAULT_DEMO_ACCESS_PASSWORD = 'RIS2026';

export function configuredDemoAccessPassword(env = process.env) {
  return env.POINTS_DEMO_PASSWORD || DEFAULT_DEMO_ACCESS_PASSWORD;
}

export function demoAccessSigningSecret(env = process.env) {
  return env.POINTS_DEMO_SECRET
    || env.CLOB_SESSION_SECRET
    || configuredDemoAccessPassword(env);
}

export function signDemoAccessExpiry(exp, env = process.env) {
  return crypto
    .createHmac('sha256', demoAccessSigningSecret(env))
    .update(String(exp))
    .digest('base64url');
}

export function readDemoAccessCookie(headers = {}) {
  return readCookie(headers, DEMO_ACCESS_COOKIE_NAME);
}

export function verifyDemoAccessCookie(value, { env = process.env, now = Date.now() } = {}) {
  if (!value) return false;
  const [expRaw, sig] = String(value).split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  return safeEqual(sig, signDemoAccessExpiry(expRaw, env));
}

export function buildDemoAccessCookie({ headers = {}, env = process.env, now = Date.now() } = {}) {
  const exp = Math.floor(now / 1000) + DEMO_ACCESS_COOKIE_TTL_SECONDS;
  const value = `${exp}.${signDemoAccessExpiry(exp, env)}`;
  const secure = headers['x-forwarded-proto'] === 'https' || env.VERCEL === '1';
  const parts = [
    `${DEMO_ACCESS_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${DEMO_ACCESS_COOKIE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function verifyDemoAccessPassword(candidate, env = process.env) {
  const expected = configuredDemoAccessPassword(env).trim().toUpperCase();
  const given = String(candidate || '').trim().toUpperCase();
  if (!safeEqual(given, expected)) {
    return { ok: false, status: 401, error: 'Contraseña incorrecta' };
  }
  return { ok: true, status: 200 };
}
