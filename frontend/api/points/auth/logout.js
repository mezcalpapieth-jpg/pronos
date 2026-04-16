/**
 * POST /api/points/auth/logout
 *
 * Clears the session cookie. That's the whole thing — the Turnkey
 * session JWT is already expiring on its own timer, and our DB row
 * stays put for future logins.
 */

import { applyCors } from '../../_lib/cors.js';
import { clearSessionCookie } from '../../_lib/session.js';

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
