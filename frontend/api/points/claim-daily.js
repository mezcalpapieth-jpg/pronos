/**
 * POST /api/points/claim-daily
 *
 * Daily MXNP drip. First claim of the day credits the user based on
 * their current streak:
 *   streak 1 → 100, streak 2 → 120, streak 3 → 140, +20/day...
 *
 * Missing a day resets the streak to 1 (100 MXNP). The claim is
 * idempotent per (username, calendar-date) — double-tap doesn't
 * double-credit.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';

const sql = neon(process.env.DATABASE_URL);

const BASE_REWARD = 100;
const STREAK_BONUS = 20;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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
    await ensurePointsSchema(sql);
    await sql.query('BEGIN');

    // Idempotency: if the user already claimed today, return the existing row.
    const existing = await sql`
      SELECT amount, streak_day FROM daily_claims
      WHERE username = ${username} AND claim_date = ${today}
    `;
    if (existing.length > 0) {
      await sql.query('ROLLBACK');
      return res.status(200).json({
        ok: true,
        alreadyClaimedToday: true,
        amount: Number(existing[0].amount),
        streakDay: existing[0].streak_day,
      });
    }

    // Figure out streak: look at last_claim_date in points_streaks.
    const streakRows = await sql`
      SELECT current_streak, last_claim_date, best_streak
      FROM points_streaks
      WHERE username = ${username}
      FOR UPDATE
    `;
    const prev = streakRows[0] || { current_streak: 0, last_claim_date: null, best_streak: 0 };
    const prevDate = prev.last_claim_date
      ? new Date(prev.last_claim_date).toISOString().slice(0, 10)
      : null;

    let streakDay;
    if (prevDate === yesterdayIso()) {
      streakDay = Number(prev.current_streak || 0) + 1;
    } else {
      streakDay = 1; // gap or first-ever claim → restart
    }
    const amount = BASE_REWARD + (streakDay - 1) * STREAK_BONUS;
    const bestStreak = Math.max(Number(prev.best_streak || 0), streakDay);

    // Credit balance
    const balanceRows = await sql`
      SELECT balance FROM points_balances WHERE username = ${username} FOR UPDATE
    `;
    const currentBalance = balanceRows.length > 0 ? Number(balanceRows[0].balance) : 0;
    const newBalance = currentBalance + amount;
    if (balanceRows.length === 0) {
      await sql`INSERT INTO points_balances (username, balance) VALUES (${username}, ${newBalance})`;
    } else {
      await sql`UPDATE points_balances SET balance = ${newBalance}, updated_at = NOW() WHERE username = ${username}`;
    }

    // Record the claim (dedupe on PK).
    await sql`
      INSERT INTO daily_claims (username, claim_date, amount, streak_day)
      VALUES (${username}, ${today}, ${amount}, ${streakDay})
      ON CONFLICT (username, claim_date) DO NOTHING
    `;

    // Update streak row
    if (streakRows.length === 0) {
      await sql`
        INSERT INTO points_streaks (username, current_streak, last_claim_date, best_streak)
        VALUES (${username}, ${streakDay}, ${today}, ${bestStreak})
      `;
    } else {
      await sql`
        UPDATE points_streaks
        SET current_streak = ${streakDay},
            last_claim_date = ${today},
            best_streak = ${bestStreak},
            updated_at = NOW()
        WHERE username = ${username}
      `;
    }

    await sql`
      INSERT INTO points_distributions (username, amount, kind, reason)
      VALUES (${username}, ${amount}, 'daily_claim',
              'Racha día ' || ${String(streakDay)} || ' · +' || ${String(amount)} || ' MXNP')
    `;

    await sql.query('COMMIT');
    return res.status(200).json({
      ok: true,
      alreadyClaimedToday: false,
      amount,
      streakDay,
      balance: newBalance,
    });
  } catch (e) {
    try { await sql.query('ROLLBACK'); } catch {}
    console.error('[points/claim-daily] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'claim_failed' });
  }
}
