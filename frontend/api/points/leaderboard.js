/**
 * GET /api/points/leaderboard
 *
 * Top predictors ranked by tournament score for /torneo, plus the old wallet
 * leaderboard for Portfolio while the current cycle finishes. Bonuses and
 * referrals fund the wallet leaderboard; tournament score stays tied to
 * market PnL and the friendly inactivity penalty.
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
import { buildWalletLeaderboardRows } from '../_lib/points-wallet-leaderboard.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);

function findByUsername(rows, username) {
  const key = String(username || '').toLowerCase();
  return (rows || []).find(row => String(row.username || '').toLowerCase() === key) || null;
}

function emptyTournamentRow(username) {
  return {
    rank: null,
    username,
    balance: 0,
    score: 0,
    cycleDelta: 0,
    marketPnl: 0,
    inactivityPenalty: 0,
    inactiveDays: 0,
    activeDays: 0,
    qualifyingMarkets: 0,
    qualified: false,
    totalActions: 0,
    buyCount: 0,
  };
}

function rankPnlLeaderboardRows(rows = []) {
  const active = (Array.isArray(rows) ? rows : [])
    .filter(row => (
      Number(row.marketPnl || 0) !== 0
      || Number(row.currentPositionValue || 0) !== 0
      || Number(row.totalActions || 0) > 0
    ))
    .map(row => ({ ...row }));

  active.sort((a, b) => {
    const pnlDiff = Number(b.marketPnl || 0) - Number(a.marketPnl || 0);
    if (pnlDiff !== 0) return pnlDiff;
    const valueDiff = Number(b.currentPositionValue || 0) - Number(a.currentPositionValue || 0);
    if (valueDiff !== 0) return valueDiff;
    const actionsDiff = Number(b.totalActions || 0) - Number(a.totalActions || 0);
    if (actionsDiff !== 0) return actionsDiff;
    return String(a.username || '').localeCompare(String(b.username || ''));
  });

  active.forEach((row, index) => {
    row.rank = index + 1;
    row.score = row.marketPnl;
    row.cycleDelta = row.marketPnl;
  });

  return active;
}

export default async function handler(req, res) {
  const timer = createApiTimer(res, 'points/leaderboard');
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    setCacheHeaders(res, { scope: 'private', maxAge: 15, staleWhileRevalidate: 60 });

    const { value: ranked, hit } = await cachedJson('points:leaderboard:ranked:v2', 15_000, async () => {
      await timer.time('schema', () => ensurePointsSchema(schemaSql));
      return await timer.time('db_leaderboard', () => buildTournamentLeaderboardRows(sql, { limit: 5000 }));
    });

    const { value: walletRanked, hit: walletHit } = await cachedJson('points:leaderboard:wallet:v1', 15_000, async () => {
      await timer.time('schema_wallet', () => ensurePointsSchema(schemaSql));
      return await timer.time('db_wallet_leaderboard', () => buildWalletLeaderboardRows(sql, { limit: 5000 }));
    });

    const top = ranked.slice(0, 10);
    const walletTop = walletRanked.slice(0, 10);
    const pnlRanked = rankPnlLeaderboardRows(ranked);
    const pnlTop = pnlRanked.slice(0, 10);

    // If signed in, include the caller's rank (even if outside top 10).
    let me = null;
    let walletMe = null;
    let pnlMe = null;
    const session = readSession(req, res);
    if (session?.username) {
      me = findByUsername(ranked, session.username) || emptyTournamentRow(session.username);
      walletMe = findByUsername(walletRanked, session.username) || {
        rank: null,
        username: session.username,
        balance: 0,
        score: 0,
        cycleDelta: -TOURNAMENT_STARTING_BALANCE,
      };
      pnlMe = findByUsername(pnlRanked, session.username) || emptyTournamentRow(session.username);
    }

    const cacheStatus = hit && walletHit ? 'hit' : 'miss';
    res.setHeader('X-Pronos-Cache', cacheStatus);
    timer.end({
      cache: cacheStatus,
      ranked: ranked.length,
      walletRanked: walletRanked.length,
      pnlRanked: pnlRanked.length,
    });
    return res.status(200).json({
      top,
      me,
      tournamentTop: top,
      tournamentMe: me,
      walletTop,
      walletMe,
      pnlTop,
      pnlMe,
      totalParticipants: ranked.length,
      walletParticipants: walletRanked.length,
      pnlParticipants: pnlRanked.length,
      startingBalance: TOURNAMENT_STARTING_BALANCE,
      rules: tournamentRulesPayload(),
    });
  } catch (e) {
    timer.end({ error: 'leaderboard_failed' });
    console.error('[points/leaderboard] error', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'leaderboard_failed' });
  }
}
