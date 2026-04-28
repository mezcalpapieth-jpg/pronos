/**
 * POST /api/points/claim-daily
 *
 * Daily MXNP drip with streak bonus (+20 per consecutive day). Atomic:
 * the claim insert, streak update, balance credit, and audit entry all
 * commit together.
 *
 * Idempotency: primary key on (username, claim_date) means a double-tap
 * on the same day can't double-credit.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { withTransaction } from '../_lib/db-tx.js';

const schemaSql = neon(process.env.DATABASE_URL);

const BASE_REWARD = 100;
const STREAK_BONUS = 20;

function todayIso() { return new Date().toISOString().slice(0, 10); }
function yesterdayIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `claim-daily:${clientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.username) return res.status(400).json({ error: 'username_required' });

  const username = session.username;
  const today = todayIso();

  try {
    await ensurePointsSchema(schemaSql);

    const result = await withTransaction(async (client) => {
      // Compute the streak + amount inside a FOR UPDATE lock on the streak
      // row so two concurrent claims serialize on it. Even with that, the
      // SELECT on daily_claims (the previous version of this code) can be
      // bypassed by a race because the read isn't covered by any lock —
      // both transactions could pass it before either commits.
      //
      // The fix is to drive idempotency from the daily_claims INSERT: do
      // it FIRST, with `ON CONFLICT DO NOTHING RETURNING *`, and treat the
      // returned row as the source of truth. If the insert returned a
      // row, *we* won the race and we credit. If it returned no row,
      // someone else already claimed today — read their row and report
      // alreadyClaimedToday without touching the balance.
      const streakResult = await client.query(
        `SELECT current_streak, last_claim_date, best_streak
         FROM points_streaks
         WHERE username = $1
         FOR UPDATE`,
        [username],
      );
      const prev = streakResult.rows[0] || { current_streak: 0, last_claim_date: null, best_streak: 0 };
      const prevDate = prev.last_claim_date
        ? new Date(prev.last_claim_date).toISOString().slice(0, 10)
        : null;
      const streakDay = prevDate === yesterdayIso()
        ? Number(prev.current_streak || 0) + 1
        : 1;
      const amount = BASE_REWARD + (streakDay - 1) * STREAK_BONUS;
      const bestStreak = Math.max(Number(prev.best_streak || 0), streakDay);

      // Atomic idempotency gate: this INSERT either succeeds (we won the
      // race for "today's claim") or returns zero rows (someone else won).
      // Everything below is only run on the winner path.
      const insertResult = await client.query(
        `INSERT INTO daily_claims (username, claim_date, amount, streak_day)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username, claim_date) DO NOTHING
         RETURNING amount, streak_day`,
        [username, today, amount, streakDay],
      );
      if (insertResult.rows.length === 0) {
        // Lost the race — fetch the row that did win and report it.
        const existingResult = await client.query(
          `SELECT amount, streak_day FROM daily_claims
           WHERE username = $1 AND claim_date = $2`,
          [username, today],
        );
        const row = existingResult.rows[0] || { amount, streak_day: streakDay };
        return {
          alreadyClaimedToday: true,
          amount: Number(row.amount),
          streakDay: row.streak_day,
        };
      }

      // We won — credit balance, update streak, write audit. Locks taken
      // here serialize against any concurrent buy/sell on the same user.
      const balanceResult = await client.query(
        `SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE`,
        [username],
      );
      const currentBalance = balanceResult.rows.length > 0 ? Number(balanceResult.rows[0].balance) : 0;
      const newBalance = currentBalance + amount;
      if (balanceResult.rows.length === 0) {
        await client.query(
          `INSERT INTO points_balances (username, balance) VALUES ($1, $2)`,
          [username, newBalance],
        );
      } else {
        await client.query(
          `UPDATE points_balances SET balance = $1, updated_at = NOW() WHERE username = $2`,
          [newBalance, username],
        );
      }

      if (streakResult.rows.length === 0) {
        await client.query(
          `INSERT INTO points_streaks (username, current_streak, last_claim_date, best_streak)
           VALUES ($1, $2, $3, $4)`,
          [username, streakDay, today, bestStreak],
        );
      } else {
        await client.query(
          `UPDATE points_streaks
           SET current_streak = $1, last_claim_date = $2, best_streak = $3, updated_at = NOW()
           WHERE username = $4`,
          [streakDay, today, bestStreak, username],
        );
      }

      await client.query(
        `INSERT INTO points_distributions (username, amount, kind, reason)
         VALUES ($1, $2, 'daily_claim', $3)`,
        [username, amount, `Racha día ${streakDay} · +${amount} MXNP`],
      );

      return { alreadyClaimedToday: false, amount, streakDay, balance: newBalance };
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[points/claim-daily] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'claim_failed' });
  }
}
