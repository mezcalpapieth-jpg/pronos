/**
 * Admin guard for points-app endpoints.
 *
 * Reads the session cookie (same one used by /api/points/auth/me) and
 * verifies that the caller's username is in POINTS_ADMIN_USERNAMES env
 * var (comma-separated list, case-insensitive). Responds 401/403
 * automatically and returns the session claims on success.
 */
import { readSession } from './session.js';

function allowlist() {
  // Local dev keeps a "mezcal,frmm,alex" fallback for convenience.
  // Vercel deploys require POINTS_ADMIN_USERNAMES to be set explicitly;
  // an empty list means "no one" — safe default.
  const fallback = process.env.VERCEL_ENV ? '' : 'mezcal,frmm,alex';
  return (process.env.POINTS_ADMIN_USERNAMES || fallback)
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function requirePointsAdmin(req, res) {
  const session = readSession(req, res);
  if (!session) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  if (!session.username) {
    res.status(403).json({ error: 'username_required' });
    return null;
  }
  const allowed = allowlist();
  if (!allowed.includes(session.username.toLowerCase())) {
    res.status(403).json({ error: 'not_admin' });
    return null;
  }
  return session;
}

export function isAdminUsername(username) {
  if (!username) return false;
  return allowlist().includes(String(username).toLowerCase());
}
