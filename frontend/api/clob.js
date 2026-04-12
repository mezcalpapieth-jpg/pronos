// ─── POLYMARKET CLOB PROXY ────────────────────────────────────────────────────
// Proxies CLOB requests server-side to avoid CORS restrictions in the browser.

import crypto from 'crypto';
import { applyCors } from './_lib/cors.js';

const CLOB_BASE = 'https://clob.polymarket.com';
const COOKIE_NAME = 'pronos_clob';
const COOKIE_TTL_SECONDS = 12 * 60 * 60;

function base64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sessionKey() {
  const secret = process.env.CLOB_SESSION_SECRET;
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

function sealSession(payload) {
  const key = sessionKey();
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [base64url(iv), base64url(tag), base64url(encrypted)].join('.');
}

function unsealSession(value) {
  const key = sessionKey();
  if (!key || !value) return null;
  try {
    const [ivRaw, tagRaw, encryptedRaw] = value.split('.');
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, 'base64url')),
      decipher.final(),
    ]);
    const parsed = JSON.parse(plaintext.toString('utf8'));
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  return raw.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || null;
}

function setClobCookie(req, res, value) {
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

function readClobSession(req, owner) {
  const session = unsealSession(getCookie(req, COOKIE_NAME));
  if (!session) return null;
  if (owner && session.address?.toLowerCase() !== owner.toLowerCase()) return null;
  if (!session.apiKey || !session.secret || !session.passphrase) return null;
  return session;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, POST, OPTIONS', credentials: true });
  if (cors) return cors;

  const { action } = req.query;

  // ── POST /api/clob?action=derive-key ─────────────────────────────────────────
  // Derives CLOB API credentials from a signed L1 message.
  // Body: { address, signature, timestamp, nonce }
  if (action === 'derive-key' && req.method === 'POST') {
    const { address, signature, timestamp, nonce = 0 } = req.body;
    if (!address || !signature || !timestamp) {
      return res.status(400).json({ error: 'address, signature, timestamp required' });
    }
    try {
      const r = await fetch(`${CLOB_BASE}/auth/derive-api-key`, {
        method: 'GET',
        headers: {
          'POLY_ADDRESS':   address,
          'POLY_SIGNATURE': signature,
          'POLY_TIMESTAMP': timestamp,
          'POLY_NONCE':     String(nonce),
        },
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);

      const { apiKey, secret, passphrase } = data || {};
      if (!apiKey || !secret || !passphrase) {
        return res.status(502).json({ error: 'CLOB did not return complete API credentials' });
      }

      const sealed = sealSession({
        address: address.toLowerCase(),
        apiKey,
        secret,
        passphrase,
        exp: Math.floor(Date.now() / 1000) + COOKIE_TTL_SECONDS,
      });

      if (!sealed) {
        return res.status(500).json({ error: 'CLOB session secret is not configured' });
      }

      setClobCookie(req, res, sealed);
      return res.status(200).json({ ok: true, apiKey });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST /api/clob?action=place-order ─────────────────────────────────────────
  // Places a signed order on the CLOB.
  // Body: { order, owner, orderType } — API creds are read from HTTP-only cookie.
  if (action === 'place-order' && req.method === 'POST') {
    const { order, owner, orderType = 'GTC' } = req.body;
    if (!order || !owner) {
      return res.status(400).json({ error: 'order and owner required' });
    }

    const creds = readClobSession(req, owner);
    if (!creds) {
      return res.status(401).json({ error: 'CLOB session expired. Please sign authentication again.' });
    }

    const body = JSON.stringify({ order, owner, orderType });
    const timestamp = Math.floor(Date.now() / 1000).toString();

    // Build L2 HMAC signature
    const message = timestamp + 'POST' + '/order' + body;
    const hmacSig = crypto
      .createHmac('sha256', Buffer.from(creds.secret, 'base64'))
      .update(message)
      .digest('base64');

    try {
      const r = await fetch(`${CLOB_BASE}/order`, {
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          'POLY_ADDRESS':   owner,
          'POLY_API_KEY':   creds.apiKey,
          'POLY_PASSPHRASE': creds.passphrase,
          'POLY_SIGNATURE': hmacSig,
          'POLY_TIMESTAMP': timestamp,
        },
        body,
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET /api/clob?action=book&token_id=… ─────────────────────────────────────
  // Returns the Polymarket CLOB order book for a token so the client can
  // estimate slippage before placing a bet. Short edge cache to avoid
  // hammering the CLOB when the user is tweaking the amount field.
  if (action === 'book' && req.method === 'GET') {
    const tokenId = req.query.token_id || req.query.tokenId;
    if (!tokenId) return res.status(400).json({ error: 'token_id required' });
    try {
      const r = await fetch(`${CLOB_BASE}/book?token_id=${encodeURIComponent(tokenId)}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'pronos.io/1.0' },
      });
      const data = await r.json();
      res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=15');
      return res.status(r.status).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── GET /api/clob?action=positions&address=0x... ──────────────────────────────
  if (action === 'positions' && req.method === 'GET') {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address required' });
    try {
      const r = await fetch(`https://data-api.polymarket.com/positions?user=${address}&sizeThreshold=0.01&limit=50`);
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(404).json({ error: 'Unknown action' });
}
