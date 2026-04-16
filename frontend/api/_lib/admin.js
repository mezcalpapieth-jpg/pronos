import { requirePrivyUser } from './auth.js';
import { ensureUserSchema, formatUserSchemaError, isUserSchemaError } from './user-schema.js';

// ADMIN_USERNAMES must be set explicitly in production. Previous default
// of 'mezcal,frmm,alex' meant anyone who registered one of those usernames
// got admin rights on any deploy where the env var wasn't configured.
// Local dev keeps the fallback for convenience; prod/preview get an empty
// list so requireAdmin() fails closed until the env var is wired up.
const ADMIN_FALLBACK = process.env.VERCEL_ENV ? '' : 'mezcal,frmm,alex';
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || ADMIN_FALLBACK)
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

if (process.env.VERCEL_ENV && ADMIN_USERNAMES.length === 0) {
  console.warn('[admin] ADMIN_USERNAMES env var is not set — admin access is disabled on this deploy.');
}

export async function getUserByPrivyId(sql, privyId) {
  if (!privyId) return null;
  try {
    const rows = await sql`SELECT username FROM users WHERE privy_id = ${privyId}`;
    return rows[0] || null;
  } catch (error) {
    if (!isUserSchemaError(error)) throw error;
    await ensureUserSchema(sql);
    const rows = await sql`SELECT username FROM users WHERE privy_id = ${privyId}`;
    return rows[0] || null;
  }
}

export async function isAdminUser(sql, privyId) {
  try {
    const user = await getUserByPrivyId(sql, privyId);
    return ADMIN_USERNAMES.includes(user?.username?.toLowerCase());
  } catch (_) {
    return false;
  }
}

export async function requireAdmin(req, res, sql, privyId) {
  const auth = await requirePrivyUser(req, res, privyId);
  if (!auth.ok) return { ok: false };

  try {
    const user = await getUserByPrivyId(sql, privyId);
    const username = user?.username?.toLowerCase();
    if (!ADMIN_USERNAMES.includes(username)) {
      res.status(403).json({ error: 'No autorizado' });
      return { ok: false };
    }
    return { ok: true, username };
  } catch (e) {
    console.error(formatUserSchemaError('requireAdmin failed', e));
    res.status(500).json({ error: 'Error verificando admin' });
    return { ok: false };
  }
}

export { ADMIN_USERNAMES };
