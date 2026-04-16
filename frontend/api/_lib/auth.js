import { webcrypto } from 'crypto';

const subtleCrypto = globalThis.crypto?.subtle ? globalThis.crypto : webcrypto;

function base64UrlToBuffer(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function jsonFromBase64Url(value) {
  return JSON.parse(base64UrlToBuffer(value).toString('utf8'));
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || null;
}

function authIsRequired() {
  // Explicit override wins.
  if (process.env.REQUIRE_PRIVY_AUTH === 'true') return true;
  if (process.env.REQUIRE_PRIVY_AUTH === 'false') return false;
  // Any Vercel deploy (preview OR production) must enforce auth.
  // Previously only 'production' did, which left preview URLs wide open:
  // without PRIVY_JWT_VERIFICATION_KEY set, requirePrivyUser would return
  // { ok: true } for any privyId the client chose — including admin ones.
  if (process.env.VERCEL_ENV) return true;
  // Local dev (no VERCEL_ENV) stays permissive by default.
  return false;
}

async function verifyEs256Jwt(token, publicKeyPem) {
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) throw new Error('Malformed auth token');

  const header = jsonFromBase64Url(encodedHeader);
  if (header.alg !== 'ES256') throw new Error('Unsupported auth token algorithm');

  const key = await subtleCrypto.subtle.importKey(
    'spki',
    Buffer.from(publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, ''), 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const ok = await subtleCrypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    base64UrlToBuffer(encodedSignature),
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
  );
  if (!ok) throw new Error('Invalid auth token signature');

  return jsonFromBase64Url(encodedPayload);
}

export async function requirePrivyUser(req, res, expectedPrivyId) {
  const required = authIsRequired();
  const verificationKey = process.env.PRIVY_JWT_VERIFICATION_KEY;
  const token = getBearerToken(req);

  if (!required && !verificationKey) {
    return { ok: true, privyId: expectedPrivyId, insecureDevMode: true };
  }

  if (!verificationKey) {
    res.status(500).json({ error: 'Privy server auth is not configured' });
    return { ok: false };
  }
  if (!token) {
    res.status(401).json({ error: 'Missing auth token' });
    return { ok: false };
  }

  try {
    const payload = await verifyEs256Jwt(token, verificationKey);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) throw new Error('Expired auth token');
    if (expectedPrivyId && payload.sub !== expectedPrivyId) throw new Error('Auth token subject mismatch');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);
    if (process.env.PRIVY_APP_ID && aud.length > 0 && !aud.includes(process.env.PRIVY_APP_ID)) {
      throw new Error('Auth token audience mismatch');
    }
    return { ok: true, privyId: payload.sub, payload };
  } catch (e) {
    res.status(401).json({ error: 'Invalid auth token' });
    return { ok: false };
  }
}
