/**
 * GET /api/points/leaderboard
 *
 * Top predictors ranked by current wallet balance (MXNP). Since all
 * balances reset to 500 MXNP on each 2-week cycle rollover, whoever has
 * the highest balance at the end of the cycle is whoever grew their
 * initial stake the most through trading + daily claims.
 *
 * Product note: this used to rank by PnL aggregated from positions, but
 * we switched to balance-based ranking because:
 *   1. Balance naturally includes daily-claim gains (rewards engagement).
 *   2. Cycle rollover resets to 500, so balance *is* the per-cycle PnL.
 *   3. Way simpler query — one SELECT instead of mark-to-market math
 *      across every open position.
 *
 * Unauthenticated caller gets the public leaderboard. Authenticated
 * caller additionally receives their own rank + balance.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { readSession } from '../_lib/session.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function round2(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

// Same amount we seed new users with; the leaderboard reports the
// delta from this so users can see cycle-to-date growth.
const CYCLE_STARTING_BALANCE = 500;

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await ensurePointsSchema(schemaSql);

    // Pull every user with a balance row. LEFT JOIN on points_users so
    // rows without a points_balances entry (edge case: user created but
    // never claimed signup) still show up, ranked at the bottom.
    const rows = await sql`
      SELECT u.username, COALESCE(b.balance, 0) AS balance
      FROM points_users u
      LEFT JOIN points_balances b ON b.username = u.username
      WHERE u.username IS NOT NULL
      ORDER BY balance DESC NULLS LAST, u.username ASC
      LIMIT 500
    `;

    const ranked = rows.map((r, i) => ({
      rank: i + 1,
      username: r.username,
      balance: round2(r.balance),
      cycleDelta: round2(Number(r.balance) - CYCLE_STARTING_BALANCE),
    }));

    const top = ranked.slice(0, 10);

    // If signed in, include the caller's rank (even if outside top 10).
    let me = null;
    const session = readSession(req, res);
    if (session?.username) {
      const hit = ranked.find(u => u.username === session.username);
      if (hit) {
        me = hit;
      } else {
        // Session exists but user has no balance row — report rank null.
        me = {
          rank: null,
          username: session.username,
          balance: 0,
          cycleDelta: -CYCLE_STARTING_BALANCE,
        };
      }
    }

    return res.status(200).json({
      top,
      me,
      totalParticipants: ranked.length,
      startingBalance: CYCLE_STARTING_BALANCE,
    });
  } catch (e) {
    console.error('[points/leaderboard] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'leaderboard_failed' });
  }
}
