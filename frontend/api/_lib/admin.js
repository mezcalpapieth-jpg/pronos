import { requirePrivyUser } from './auth.js';

const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'mezcal,frmm,alex')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export async function getUserByPrivyId(sql, privyId) {
  if (!privyId) return null;
  const rows = await sql`SELECT username FROM users WHERE privy_id = ${privyId}`;
  return rows[0] || null;
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
    res.status(500).json({ error: 'Error verificando admin' });
    return { ok: false };
  }
}

export { ADMIN_USERNAMES };
