import test from 'node:test';
import assert from 'node:assert/strict';
import { rankWalletLeaderboardRows } from './points-wallet-leaderboard.js';

test('wallet leaderboard ranks by current balance, not account creation order', () => {
  const rows = [
    { username: 'first_user', balance: 500, created_at: '2026-08-01T00:00:00.000Z' },
    { username: 'mezcal', balance: 970.58, created_at: '2026-08-03T00:00:00.000Z' },
    { username: 'frmm', balance: 1276.31, created_at: '2026-08-04T00:00:00.000Z' },
    { username: 'joaquinrmx', balance: 750, created_at: '2026-08-05T00:00:00.000Z' },
  ];

  const ranked = rankWalletLeaderboardRows(rows, { startingBalance: 500 });

  assert.deepEqual(ranked.map(row => row.username), ['frmm', 'mezcal', 'joaquinrmx', 'first_user']);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[0].cycleDelta, 776.31);
  assert.equal(ranked[3].cycleDelta, 0);
});

test('wallet leaderboard uses username as deterministic tie breaker', () => {
  const ranked = rankWalletLeaderboardRows([
    { username: 'zeta', balance: 650 },
    { username: 'alpha', balance: 650 },
  ]);

  assert.deepEqual(ranked.map(row => `${row.rank}:${row.username}`), ['1:alpha', '2:zeta']);
});
