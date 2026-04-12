import crypto from 'crypto';
import { applyCors } from './_lib/cors.js';

const COOKIE_NAME = 'pronos_mvp_access';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

function configuredPassword() {
  if (process.env.MVP_ACCESS_PASSWORD) return process.env.MVP_ACCESS_PASSWORD;
  if (process.env.VERCEL_ENV === 'production') return null;
  return 'mezcal';
}

function signingSecret() {
  return process.env.MVP_ACCESS_SECRET || process.env.CLOB_SESSION_SECRET || process.env.MVP_ACCESS_PASSWORD || configuredPassword();
}

function sign(exp) {
  return crypto.createHmac('sha256', signingSecret()).update(String(exp)).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verify(value) {
  if (!value || !signingSecret()) return false;
  const [expRaw, sig] = value.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(expRaw);
  return safeEqual(sig, expected);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

function setAccessCookie(req, res) {
  const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS;
  const value = `${exp}.${sign(exp)}`;
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1';
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: verify(getCookie(req, COOKIE_NAME)) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const password = configuredPassword();
  if (!password || !signingSecret()) {
    return res.status(500).json({ error: 'MVP access gate is not configured' });
  }

  const candidate = String(req.body?.password || '').trim();
  const ok = safeEqual(candidate, password);
  if (!ok) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  setAccessCookie(req, res);
  return res.status(200).json({ ok: true });
}
