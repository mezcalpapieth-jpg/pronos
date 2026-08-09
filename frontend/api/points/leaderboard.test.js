import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./leaderboard.js', import.meta.url), 'utf8');

test('points leaderboard returns wallet and PnL rankings separately', () => {
  assert.match(source, /buildWalletLeaderboardRows/);
  assert.match(source, /walletTop/);
  assert.match(source, /walletMe/);
  assert.match(source, /pnlTop/);
  assert.match(source, /pnlMe/);
  assert.match(source, /tournamentTop/);
});

test('points leaderboard keeps tournament top distinct from portfolio wallet top', () => {
  assert.match(source, /const top = ranked\.slice\(0, 10\)/);
  assert.match(source, /const walletTop = walletRanked\.slice\(0, 10\)/);
  assert.match(source, /rankPnlLeaderboardRows\(ranked\)/);
});
