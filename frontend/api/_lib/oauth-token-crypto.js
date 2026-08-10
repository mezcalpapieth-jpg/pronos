import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function tokenCipherKey(env = process.env) {
  const secret = String(
    env.SOCIAL_OAUTH_TOKEN_SECRET
      || env.OAUTH_TOKEN_SECRET
      || env.OAUTH_COOKIE_SECRET
      || env.POINTS_SESSION_SECRET
      || env.SESSION_SECRET
      || env.MVP_ACCESS_SECRET
      || env.CLOB_SESSION_SECRET
      || '',
  ).trim();
  if (!secret) return null;
  return createHash('sha256').update(secret).digest();
}

export function encryptOAuthToken(value, env = process.env) {
  const raw = String(value || '');
  if (!raw) return null;
  const key = tokenCipherKey(env);
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptOAuthToken(value, env = process.env) {
  const raw = String(value || '');
  if (!raw) return null;
  const key = tokenCipherKey(env);
  if (!key) return null;
  const [version, iv, tag, encrypted] = raw.split(':');
  if (version !== 'v1' || !iv || !tag || !encrypted) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
