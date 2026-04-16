/**
 * POST /api/points/auth/username
 * Body: { username }
 *
 * Claims a username for the authenticated sub-org and atomically seeds
 * the user's MXNP balance with the signup bonus (500 MXNP) if this is
 * their first time. Username claim, balance insert, and audit entry all
 * commit together.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { readSession, createSessionToken, setSessionCookie } from '../../_lib/session.js';
import { withTransaction } from '../../_lib/db-tx.js';
import { sendPointsWelcomeEmail } from '../../_lib/welcome-email.js';

const sql = neon(process.env.DATABASE_URL);

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;
const SIGNUP_BONUS = 500;

export default async function handler(req, res) {
  // Top-level try/catch ensures we always return JSON, never a raw 500.
  try {
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

      // Uniqueness probe first: returning a targeted error is friendlier
      // than letting the UNIQUE constraint fire inside the transaction.
      const taken = await sql`
        SELECT turnkey_sub_org_id
        FROM points_users
        WHERE LOWER(username) = ${username}
        LIMIT 1
      `;
      if (taken.length > 0 && taken[0].turnkey_sub_org_id !== session.sub) {
        return res.status(409).json({ error: 'username_taken' });
      }

      const claimed = await withTransaction(async (client) => {
        const claim = await client.query(
          `UPDATE points_users
           SET username = $1
           WHERE turnkey_sub_org_id = $2
             AND (username IS NULL OR LOWER(username) = $1)
           RETURNING username`,
          [username, session.sub],
        );
        if (claim.rows.length === 0) {
          const err = new Error('already_set'); err.status = 409; throw err;
        }

        // First balance row → seed signup bonus + audit. Existing users
        // that already had a row keep their balance as-is.
        const bal = await client.query(
          `INSERT INTO points_balances (username, balance)
           VALUES ($1, $2)
           ON CONFLICT (username) DO NOTHING
           RETURNING balance`,
          [username, SIGNUP_BONUS],
        );
        const isFirstTime = bal.rows.length > 0;
        if (isFirstTime) {
          await client.query(
            `INSERT INTO points_distributions (username, amount, kind, reason)
             VALUES ($1, $2, 'signup_bonus', 'Bono de bienvenida')`,
            [username, SIGNUP_BONUS],
          );
        }

        return { username, isFirstTime };
      });

      // Fire-and-forget welcome email on first signup. Uses Resend via
      // the shared helper; silently no-ops if RESEND_API_KEY isn't set.
      // Wrapped in Promise.resolve so a slow email provider never blocks
      // the response — the UI should feel snappy even if SMTP hiccups.
      if (claimed.isFirstTime && session.email) {
        Promise.resolve(sendPointsWelcomeEmail({
          email: session.email,
          username: claimed.username,
        })).catch(err => {
          console.error('[auth/username] welcome email failed', {
            message: err?.message,
          });
        });
      }

      let token;
      try {
        token = createSessionToken({
          suborgId: session.sub,
          email: session.email,
          username: claimed.username,
        });
        setSessionCookie(res, token);
      } catch (tokenErr) {
        console.error('[auth/username] session token error', { message: tokenErr?.message });
        return res.status(500).json({
          error: 'session_config_missing',
          detail: 'POINTS_SESSION_SECRET is not configured on the server.',
        });
      }

      return res.status(200).json({ ok: true, username: claimed.username });
    } catch (e) {
      if (e?.status && typeof e?.message === 'string') {
        return res.status(e.status).json({ error: e.message });
      }
      if (e?.code === '23505') {
        // Race condition — another request claimed the same username first.
        return res.status(409).json({ error: 'username_taken' });
      }
      console.error('[auth/username] error', { message: e?.message, code: e?.code });
      return res.status(500).json({ error: 'db_unavailable', detail: e?.message?.slice(0, 240) || null });
    }
  } catch (e) {
    console.error('[auth/username] unhandled error', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
