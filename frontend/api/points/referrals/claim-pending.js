/**
 * POST /api/points/referrals/claim-pending
 * Body: { referrer }  — username of the referrer
 *
 * Called right after the user picks their username. The client reads the
 * referrer from localStorage (set by the /r/<username> landing) and
 * submits it so we record the pair. The referrer + referred bonuses are
 * credited here atomically.
 *
 * Rules (from the campaign doc):
 *   - Referrer:  +100 MXNP per confirmed referral
 *   - Referred:  +50  MXNP bonus
 *   - One-time per referred account. Duplicate calls are no-ops.
 *   - Self-referral rejected.
 *   - Referrer must already exist as a user (prevents typos paying out).
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { ensurePointsSchema } from '../../_lib/points-schema.js';
import { requireSession } from '../../_lib/session.js';
import { withTransaction } from '../../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

const REFERRER_REWARD = 100;
const REFERRED_REWARD = 50;
const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/;

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const { referrer } = req.body || {};
  const ref = String(referrer || '').toLowerCase().trim();
  if (!USERNAME_RE.test(ref)) {
    return res.status(400).json({ error: 'invalid_referrer' });
  }
  if (ref === session.username.toLowerCase()) {
    return res.status(400).json({ error: 'self_referral' });
  }

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      // Confirm the referrer exists — protects against typos and attempted
      // credit to non-users.
      const referrerExists = await client.query(
        `SELECT username FROM points_users WHERE LOWER(username) = $1 LIMIT 1`,
        [ref],
      );
      if (referrerExists.rows.length === 0) {
        const err = new Error('referrer_not_found'); err.status = 404; throw err;
      }

      // Insert referral pair; ON CONFLICT means this is a no-op for any
      // later attempt (referred is UNIQUE in the schema).
      const inserted = await client.query(
        `INSERT INTO points_referrals (referrer, referred, rewarded, rewarded_at)
         VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (referred) DO NOTHING
         RETURNING id`,
        [ref, session.username.toLowerCase()],
      );
      if (inserted.rows.length === 0) {
        // Pair already existed — don't double-credit.
        return { alreadyClaimed: true };
      }

      // Credit both sides.
      await creditBalance(client, ref, REFERRER_REWARD, 'referral_bonus',
        `Referiste a @${session.username}`);
      await creditBalance(client, session.username.toLowerCase(), REFERRED_REWARD, 'referral_bonus',
        `Bono por registrarte con @${ref}`);

      return {
        alreadyClaimed: false,
        referrer: ref,
        referrerReward: REFERRER_REWARD,
        referredReward: REFERRED_REWARD,
      };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message });
    }
    console.error('[referrals/claim-pending] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'claim_failed' });
  }
}

async function creditBalance(client, username, amount, kind, reason) {
  await client.query(
    `INSERT INTO points_balances (username, balance)
     VALUES ($1, $2)
     ON CONFLICT (username) DO UPDATE
     SET balance = points_balances.balance + EXCLUDED.balance,
         updated_at = NOW()`,
    [username, amount],
  );
  await client.query(
    `INSERT INTO points_distributions (username, amount, kind, reason)
     VALUES ($1, $2, $3, $4)`,
    [username, amount, kind, reason],
  );
}
