/**
 * POST /api/points/auth/username
 * Body: { username }
 *
 * Claims a username for the authenticated sub-org. Also seeds the new
 * user's MXNP balance with the signup bonus (500 MXNP) and logs it as
 * an audit entry.
 *
 * Username rules (conservative — easier to open up later than tighten):
 *   - 3..20 chars
 *   - lowercase letters, digits, underscore
 *   - must start with a letter
 *
 * Error codes:
 *   invalid_username      — pattern failed
 *   username_taken        — case-insensitive collision
 *   already_set           — user already has a username on file
 *   not_authenticated     — missing/invalid session cookie
 *   db_unavailable        — Postgres call failed
 */

import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession, createSessionToken, setSessionCookie } from '../../_lib/session.js';

const sql = neon(process.env.DATABASE_URL);

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const SIGNUP_BONUS = 500;   // MXNP credited on first username set

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const session = readSession(req, res);
  if (!session) return res.status(401).json({ error: 'not_authenticated' });

  const raw = (req.body && req.body.username) || '';
  const username = String(raw).toLowerCase().trim();
  if (!USERNAME_RE.test(username)) {
    return res.status(400).json({ error: 'invalid_username' });
  }

  try {
    await ensurePointsSchema(sql);

    // Reject duplicates up front (case-insensitive) so we can return a
    // specific error instead of a unique-constraint 500.
    const existing = await sql`
      SELECT turnkey_sub_org_id
      FROM points_users
      WHERE LOWER(username) = ${username}
      LIMIT 1
    `;
    if (existing.length > 0 && existing[0].turnkey_sub_org_id !== session.sub) {
      return res.status(409).json({ error: 'username_taken' });
    }

    // Try to claim the username. If the user already set one, bail out.
    const claimed = await sql`
      UPDATE points_users
      SET username = ${username}
      WHERE turnkey_sub_org_id = ${session.sub}
        AND (username IS NULL OR LOWER(username) = ${username})
      RETURNING username
    `;
    if (claimed.length === 0) {
      // Either row doesn't exist (shouldn't happen — verify-otp creates it)
      // or username is already set to something else.
      return res.status(409).json({ error: 'already_set' });
    }

    // If this is the very first time we're seeing this user, seed their
    // MXNP balance with the signup bonus. We detect "first time" by
    // there being no points_balances row yet.
    await sql.query('BEGIN');
    try {
      const bal = await sql`
        INSERT INTO points_balances (username, balance)
        VALUES (${username}, ${SIGNUP_BONUS})
        ON CONFLICT (username) DO NOTHING
        RETURNING balance
      `;
      if (bal.length > 0) {
        await sql`
          INSERT INTO points_distributions (username, amount, kind, reason)
          VALUES (${username}, ${SIGNUP_BONUS}, 'signup_bonus', 'Bono de bienvenida')
        `;
      }
      await sql.query('COMMIT');
    } catch (innerErr) {
      try { await sql.query('ROLLBACK'); } catch {}
      throw innerErr;
    }
  } catch (e) {
    console.error('[auth/username] db error', { message: e?.message, code: e?.code });
    if (e?.code === '23505') {
      // Unique constraint race — another request claimed it first.
      return res.status(409).json({ error: 'username_taken' });
    }
    return res.status(500).json({ error: 'db_unavailable' });
  }

  // Refresh the session cookie so subsequent requests see the username
  // without needing to hit the DB.
  const token = createSessionToken({
    suborgId: session.sub,
    email: session.email,
    username,
  });
  setSessionCookie(res, token);

  return res.status(200).json({ ok: true, username });
}
