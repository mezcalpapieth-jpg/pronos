/**
 * GET /api/points/auth/me
 *
 * Returns the current authenticated user + balance. Used by the client
 * to hydrate auth state on page load and after refresh.
 *
 * Response:
 *   { authenticated: true, suborgId, username, email, walletAddress, balance }
 *   or
 *   { authenticated: false }
 *
 * Never 401s — an unauthenticated caller just gets `authenticated: false`.
 * The client uses this to decide whether to show the login modal.
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession } from '../../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const session = readSession(req, res);
  if (!session) {
    return res.status(200).json({ authenticated: false });
  }

  try {
    await ensurePointsSchema(schemaSql);
    const rows = await sql`
      SELECT u.turnkey_sub_org_id, u.wallet_address, u.username, u.email,
             COALESCE(b.balance, 0) AS balance
      FROM points_users u
      LEFT JOIN points_balances b ON b.username = u.username
      WHERE u.turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    if (rows.length === 0) {
      // Session cookie references a sub-org we don't have a row for
      // (likely a manual DB edit). Treat as unauthenticated.
      return res.status(200).json({ authenticated: false });
    }
    const r = rows[0];
    return res.status(200).json({
      authenticated: true,
      suborgId: r.turnkey_sub_org_id,
      username: r.username,
      email: r.email || session.email || null,
      walletAddress: r.wallet_address,
      balance: Number(r.balance || 0),
      needsUsername: !r.username,
    });
  } catch (e) {
    console.error('[auth/me] db error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'db_unavailable' });
  }
}
