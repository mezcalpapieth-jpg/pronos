import crypto from 'crypto';

export const MVP_ACCESS_COOKIE_NAME = 'pronos_mvp_access';
export const MVP_ACCESS_COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function configuredMvpAccessPassword(env = process.env) {
  if (env.MVP_ACCESS_PASSWORD) return env.MVP_ACCESS_PASSWORD;
  if (env.VERCEL_ENV === 'production') return null;
  return 'mezcal';
}

export function mvpAccessSigningSecret(env = process.env) {
  return env.MVP_ACCESS_SECRET
    || env.CLOB_SESSION_SECRET
    || env.MVP_ACCESS_PASSWORD
    || configuredMvpAccessPassword(env);
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function signMvpAccessExpiry(exp, env = process.env) {
  return crypto.createHmac('sha256', mvpAccessSigningSecret(env)).update(String(exp)).digest('base64url');
}

export function readCookie(headers = {}, name = MVP_ACCESS_COOKIE_NAME) {
  const raw = headers.cookie || headers.Cookie || '';
  return raw.split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || null;
}

export function verifyMvpAccessCookie(value, { env = process.env, now = Date.now() } = {}) {
  if (!value || !mvpAccessSigningSecret(env)) return false;
  const [expRaw, sig] = value.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const expected = signMvpAccessExpiry(expRaw, env);
  return safeEqual(sig, expected);
}

export function buildMvpAccessCookie({ headers = {}, env = process.env, now = Date.now() } = {}) {
  const exp = Math.floor(now / 1000) + MVP_ACCESS_COOKIE_TTL_SECONDS;
  const value = `${exp}.${signMvpAccessExpiry(exp, env)}`;
  const secure = headers['x-forwarded-proto'] === 'https' || env.VERCEL === '1';
  const parts = [
    `${MVP_ACCESS_COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MVP_ACCESS_COOKIE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function verifyMvpAccessPassword(candidate, env = process.env) {
  const password = configuredMvpAccessPassword(env);
  if (!password || !mvpAccessSigningSecret(env)) {
    return { ok: false, status: 500, error: 'MVP access gate is not configured' };
  }

  const ok = safeEqual(String(candidate || '').trim(), password);
  if (!ok) return { ok: false, status: 401, error: 'Incorrect password' };
  return { ok: true, status: 200 };
}
