/**
 * GET /api/points/leaderboard
 *
 * Top predictors ranked by tournament score: market PnL marked to the
 * current AMM price, minus friendly inactivity penalties. Bonuses and
 * referrals fund the account but do not directly lift the tournament score.
 *
 * Unauthenticated caller gets the public leaderboard. Authenticated
 * caller additionally receives their own rank + balance.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { readSession } from '../_lib/session.js';
import { cachedJson, createApiTimer, setCacheHeaders } from '../_lib/api-performance.js';
import {
  TOURNAMENT_STARTING_BALANCE,
  tournamentRulesPayload,
} from '../_lib/points-tournament-config.js';
import { buildTournamentLeaderboardRows } from '../_lib/points-tournament-leaderboard.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/leaderboard');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    setCacheHeaders(res, { scope: 'private', maxAge: 15, staleWhileRevalidate: 60 });

    const { value: ranked, hit } = await cachedJson('points:leaderboard:ranked:v2', 15_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(schemaSql));
      return await timer.time('db_leaderboard', () => buildTournamentLeaderboardRows(sql, { limit: 500 }));
    });

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
          score: 0,
          cycleDelta: 0,
          marketPnl: 0,
          inactivityPenalty: 0,
          inactiveDays: 0,
          activeDays: 0,
          qualifyingMarkets: 0,
          qualified: false,
        };
      }
    }

    res.setHeader('X-Pronos-Cache', hit ? 'hit' : 'miss');
    timer.end({ cache: hit ? 'hit' : 'miss', ranked: ranked.length });
    return res.status(200).json({
      top,
      me,
      totalParticipants: ranked.length,
      startingBalance: TOURNAMENT_STARTING_BALANCE,
      rules: tournamentRulesPayload(),
    });
  } catch (e) {
    timer.end({ error: 'leaderboard_failed' });
    console.error('[points/leaderboard] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'leaderboard_failed' });
  }
}
