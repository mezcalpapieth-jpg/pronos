import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHoldBonusByUser,
  tournamentHoldRewardForCostBasis,
} from './points-tournament-leaderboard.js';

const SEPTEMBER_WINDOW = {
  startsAt: '2026-09-01T15:00:00.000Z',
  rankingCutoffAt: '2026-10-01T05:59:00.000Z',
};

test('tournament hold reward pays 25% per completed week capped at four weeks', () => {
  const reward = tournamentHoldRewardForCostBasis(100, '2026-09-01T15:00:00.000Z', {
    now: new Date('2026-10-01T05:59:00.000Z'),
    window: SEPTEMBER_WINDOW,
  });
  assert.equal(reward.weeks, 4);
  assert.equal(reward.bonus, 100);
});

test('tournament hold reward does not pay for partial first week', () => {
  const reward = tournamentHoldRewardForCostBasis(100, '2026-09-26T15:00:00.000Z', {
    now: new Date('2026-10-01T05:59:00.000Z'),
    window: SEPTEMBER_WINDOW,
  });
  assert.equal(reward.weeks, 0);
  assert.equal(reward.bonus, 0);
});

test('tournament hold reward gives each added lot its own timer', () => {
  const bonuses = buildHoldBonusByUser([
    {
      id: 1,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'buy',
      shares: 1000,
      collateral: 1000,
      created_at: '2026-09-01T15:00:00.000Z',
      tournament_featured: true,
    },
    {
      id: 2,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'buy',
      shares: 1000,
      collateral: 1000,
      created_at: '2026-09-08T15:00:00.000Z',
      tournament_featured: true,
    },
  ], {
    now: new Date('2026-09-15T15:00:00.000Z'),
    window: SEPTEMBER_WINDOW,
  });

  assert.equal(bonuses.get('ana'), 750);
});

test('tournament hold reward nets hedges against newest primary lots first', () => {
  const bonuses = buildHoldBonusByUser([
    {
      id: 1,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'buy',
      shares: 1000,
      collateral: 1000,
      created_at: '2026-09-01T15:00:00.000Z',
      tournament_featured: true,
    },
    {
      id: 2,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'buy',
      shares: 1000,
      collateral: 1000,
      created_at: '2026-09-08T15:00:00.000Z',
      tournament_featured: true,
    },
    {
      id: 3,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 1,
      side: 'buy',
      shares: 500,
      collateral: 500,
      created_at: '2026-09-08T15:00:00.000Z',
      tournament_featured: true,
    },
  ], {
    now: new Date('2026-09-15T15:00:00.000Z'),
    window: SEPTEMBER_WINDOW,
  });

  assert.equal(bonuses.get('ana'), 625);
});

test('tournament hold reward removes sold shares from oldest lots', () => {
  const bonuses = buildHoldBonusByUser([
    {
      id: 1,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'buy',
      shares: 1000,
      collateral: 1000,
      created_at: '2026-09-01T15:00:00.000Z',
      tournament_featured: true,
    },
    {
      id: 2,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'buy',
      shares: 1000,
      collateral: 1000,
      created_at: '2026-09-08T15:00:00.000Z',
      tournament_featured: true,
    },
    {
      id: 3,
      username: 'ana',
      market_id: 10,
      exposure_group_id: 10,
      outcome_index: 0,
      side: 'sell',
      shares: 500,
      collateral: 350,
      created_at: '2026-09-12T15:00:00.000Z',
      tournament_featured: true,
    },
  ], {
    now: new Date('2026-09-15T15:00:00.000Z'),
    window: SEPTEMBER_WINDOW,
  });

  assert.equal(bonuses.get('ana'), 500);
});
