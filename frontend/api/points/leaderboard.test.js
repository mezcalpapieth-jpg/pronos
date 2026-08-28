import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./leaderboard.js', import.meta.url), 'utf8');
const tournamentSource = await readFile(new URL('../_lib/points-tournament-leaderboard.js', import.meta.url), 'utf8');

test('points leaderboard returns wallet and PnL rankings separately', () => {
  assert.match(source, /buildWalletLeaderboardRows/);
  assert.match(source, /walletTop/);
  assert.match(source, /walletMe/);
  assert.match(source, /pnlTop/);
  assert.match(source, /pnlMe/);
  assert.match(source, /tournamentTop/);
  assert.match(source, /holdBonus/);
  assert.match(source, /liquidityReward/);
  assert.match(source, /parlayPnl/);
});

test('points leaderboard keeps tournament top distinct from portfolio wallet top', () => {
  assert.match(source, /const PUBLIC_LEADERBOARD_LIMIT = 20/);
  assert.match(source, /const top = ranked\.slice\(0, PUBLIC_LEADERBOARD_LIMIT\)/);
  assert.match(source, /const walletTop = walletRanked\.slice\(0, 10\)/);
  assert.match(source, /rankPnlLeaderboardRows\(ranked\)/);
});

test('points tournament leaderboard scores against the active cycle window', () => {
  assert.match(tournamentSource, /resolveTournamentScoringWindow/);
  assert.match(tournamentSource, /FROM points_cycles/);
  assert.match(tournamentSource, /WHERE status = 'active'/);
  assert.match(tournamentSource, /return null/);
  assert.match(tournamentSource, /buildNeutralLeaderboardRows/);
  assert.match(tournamentSource, /const startIso = scoringWindow\.startsAt/);
  assert.match(tournamentSource, /const cutoffIso = scoringWindow\.rankingCutoffAt/);
  assert.match(tournamentSource, /readLiquidityRewardRows/);
  assert.match(tournamentSource, /kind = 'limit_maker_reward'/);
  assert.match(tournamentSource, /marketPnl \+ holdBonus \+ liquidityReward \+ parlayPnl/);
  assert.match(source, /points:leaderboard:ranked:v7/);
  assert.match(source, /profileImageUrl:\s*null/);
  assert.match(tournamentSource, /u\.profile_image_url/);
  assert.match(tournamentSource, /profileImageUrl:\s*user\.profile_image_url \|\| null/);
  assert.match(source, /readFrozenLeaderboardRowsForActiveCutoff/);
  assert.match(source, /if \(frozen\?\.rows\?\.length\) return frozen\.rows/);
});
