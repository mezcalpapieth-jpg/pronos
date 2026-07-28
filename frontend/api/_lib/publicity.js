import crypto from 'crypto';

export const PUBLICITY_SOURCES = [
  { source: 'instagram', label: 'Instagram', path: '/i' },
  { source: 'tiktok', label: 'TikTok', path: '/t' },
  { source: 'x', label: 'X', path: '/x' },
];

const SOURCE_SET = new Set(PUBLICITY_SOURCES.map(item => item.source));

export const PUBLICITY_VISITOR_COOKIE = 'pronos_publicity_id';
export const PUBLICITY_SOURCE_COOKIE = 'pronos_publicity_source';
export const PUBLICITY_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 45;

export function normalizePublicitySource(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/^-/, '');
  if (raw === 'a' || raw === 'ig' || raw === 'i') return 'instagram';
  if (raw === 'b' || raw === 'tt' || raw === 't') return 'tiktok';
  if (raw === 'c') return 'x';
  if (raw === 'twitter') return 'x';
  return SOURCE_SET.has(raw) ? raw : null;
}

export function parsePublicityCookieHeader(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(rawValue);
    } catch {
      cookies[key] = rawValue;
    }
  }
  return cookies;
}

export function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const next = Array.isArray(existing)
    ? [...existing, cookie]
    : existing
      ? [existing, cookie]
      : cookie;
  res.setHeader('Set-Cookie', next);
}

function shouldUseSecureCookie(req) {
  return req.headers?.['x-forwarded-proto'] === 'https'
    || process.env.VERCEL === '1'
    || !!process.env.VERCEL_ENV;
}

function cookieParts(name, value, req) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${PUBLICITY_COOKIE_TTL_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (shouldUseSecureCookie(req)) parts.push('Secure');
  return parts.join('; ');
}

export function ensurePublicityVisitorId(req) {
  const cookies = parsePublicityCookieHeader(req.headers?.cookie);
  const existing = String(cookies[PUBLICITY_VISITOR_COOKIE] || '').trim();
  return existing || crypto.randomUUID();
}

export function setPublicityCookies(req, res, { visitorId, source }) {
  if (visitorId) {
    appendSetCookie(res, cookieParts(PUBLICITY_VISITOR_COOKIE, visitorId, req));
  }
  if (source) {
    appendSetCookie(res, cookieParts(PUBLICITY_SOURCE_COOKIE, source, req));
  }
}

export function readPublicityCookies(req) {
  const cookies = parsePublicityCookieHeader(req.headers?.cookie);
  return {
    visitorId: cookies[PUBLICITY_VISITOR_COOKIE] || null,
    source: normalizePublicitySource(cookies[PUBLICITY_SOURCE_COOKIE]),
  };
}

export function hashPublicityVisitorKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
