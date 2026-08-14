import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProtocolLeaderboardPayload,
  buildProtocolUserProfilePayload,
} from './protocol-leaderboard.js';

test('buildProtocolLeaderboardPayload ranks portfolio value, total won, and biggest single win', () => {
  const payload = buildProtocolLeaderboardPayload({
    users: [
      {
        username: 'ana',
        walletAddress: '0xaaa',
        walletBalance: 40,
        openPositionValue: 80,
        totalWon: 500,
        biggestWin: 300,
        biggestWinMarketId: 10,
        biggestWinQuestion: '¿Gana PSG?',
      },
      {
        username: 'bob',
        walletAddress: '0xbbb',
        walletBalance: 250,
        openPositionValue: 0,
        totalWon: 100,
        biggestWin: 100,
      },
      {
        username: 'camila',
        walletAddress: '0xccc',
        walletBalance: 20,
        openPositionValue: 60,
        totalWon: 700,
        biggestWin: 700,
        biggestWinMarketId: 12,
        biggestWinQuestion: '¿Gana Arsenal?',
      },
    ],
  });

  assert.equal(payload.portfolio[0].username, 'bob');
  assert.equal(payload.portfolio[0].portfolioValue, 250);
  assert.equal(payload.totalWon[0].username, 'camila');
  assert.equal(payload.totalWon[0].totalWon, 700);
  assert.equal(payload.biggestWin[0].username, 'camila');
  assert.equal(payload.biggestWin[0].biggestWinMarketId, 12);
  assert.equal(payload.totalParticipants, 3);
});

test('buildProtocolLeaderboardPayload searches usernames across all boards without cycle metadata', () => {
  const payload = buildProtocolLeaderboardPayload({
    query: 'an',
    users: [
      { username: 'ana', walletBalance: 40, openPositionValue: 80, totalWon: 500, biggestWin: 300 },
      { username: 'bob', walletBalance: 250, openPositionValue: 0, totalWon: 100, biggestWin: 100 },
      { username: 'dani', walletBalance: 10, openPositionValue: 10, totalWon: 20, biggestWin: 20 },
    ],
  });

  assert.deepEqual(payload.portfolio.map(row => row.username), ['ana', 'dani']);
  assert.equal(payload.query, 'an');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'cycle'), false);
});

test('buildProtocolUserProfilePayload exposes on-chain money stats for public profiles', () => {
  const payload = buildProtocolUserProfilePayload({
    user: { username: 'ana', walletAddress: '0xaaa', joinedAt: '2026-05-18T00:00:00Z' },
    metrics: {
      walletBalance: 40,
      openPositionValue: 80,
      totalWon: 500,
      biggestWin: 300,
      biggestWinMarketId: 10,
      biggestWinQuestion: '¿Gana PSG?',
    },
    active: [{ marketId: 10, question: '¿Gana PSG?', currentValue: 80 }],
    history: [{ marketId: 10, side: 'redeem', collateral: 300 }],
  });

  assert.equal(payload.user.username, 'ana');
  assert.equal(payload.stats.portfolioValue, 120);
  assert.equal(payload.stats.totalWon, 500);
  assert.equal(payload.stats.biggestWin, 300);
  assert.equal(payload.active.length, 1);
  assert.equal(payload.history.length, 1);
});
