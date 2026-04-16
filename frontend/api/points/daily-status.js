/**
 * GET /api/points/daily-status
 *
 * Returns whether the authenticated user has already claimed today's
 * MXNP drip, plus their current streak day. Cheap read-only endpoint
 * used by the earn + portfolio cards to render the right button state
 * (active vs. locked-greyed) before the user interacts.
 *
 * Response:
 *   {
 *     alreadyClaimedToday: boolean,
 *     claimedAmount: number | null,   // today's credit if already claimed
 *     streakDay: number | null,       // current streak (0 if never claimed)
 *     nextClaimAtUtc: string          // ISO — tomorrow 00:00 UTC
 *   }
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { requireSession } from '../_lib/session.js';

let _sql = null;
let _schemaSql = null;
function getSql() {
  if (_sql) return _sql;
  const cs = process.env.DATABASE_READ_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _sql = neon(cs);
  return _sql;
}
function getSchemaSql() {
  if (_schemaSql) return _schemaSql;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error('DATABASE_URL not configured');
  _schemaSql = neon(cs);
  return _schemaSql;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextUtcMidnight() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function handler(req, res) {
  try {
    const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
    if (cors) return cors;
    if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

    const session = requireSession(req, res);
    if (!session) return;
    if (!session.username) return res.status(400).json({ error: 'username_required' });

    try {
      const sql = getSql();
      await ensurePointsSchema(getSchemaSql());

      const today = todayIso();
      const username = session.username;

      // Two-field probe: today's claim row (if any) + latest streak row.
      // Kept as separate queries because daily_claims is keyed on
      // (username, claim_date) for idempotency while points_streaks has
      // its own primary key on username alone.
      const [claimed, streak] = await Promise.all([
        sql`
          SELECT amount, streak_day
          FROM daily_claims
          WHERE username = ${username} AND claim_date = ${today}
          LIMIT 1
        `,
        sql`
          SELECT current_streak, last_claim_date, best_streak
          FROM points_streaks
          WHERE username = ${username}
          LIMIT 1
        `,
      ]);

      const claim = claimed[0] || null;
      const s = streak[0] || null;
      return res.status(200).json({
        alreadyClaimedToday: !!claim,
        claimedAmount: claim ? Number(claim.amount) : null,
        streakDay: claim ? claim.streak_day : (s ? Number(s.current_streak) : 0),
        bestStreak: s ? Number(s.best_streak) : 0,
        nextClaimAtUtc: nextUtcMidnight(),
      });
    } catch (e) {
      console.error('[points/daily-status] db error', { message: e?.message, code: e?.code });
      return res.status(500).json({
        error: 'db_unavailable',
        detail: e?.message?.slice(0, 240) || null,
      });
    }
  } catch (e) {
    console.error('[points/daily-status] unhandled', { message: e?.message });
    return res.status(500).json({
      error: 'server_error',
      detail: e?.message?.slice(0, 240) || null,
    });
  }
}
