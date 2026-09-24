import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConvictionBonusByUser,
  tournamentConvictionMultiplierForLot,
} from './points-tournament-leaderboard.js';

const OPEN = '2026-10-01T06:00:00.000Z';
const HALF = '2026-10-16T06:00:00.000Z';
const CLOSE = '2026-10-31T06:00:00.000Z';
const RESOLVED = '2026-10-31T06:05:00.000Z';
const OCTOBER_WINDOW = {
  startsAt: OPEN,
  operationCloseAt: CLOSE,
  rankingCutoffAt: '2026-11-01T05:59:00.000Z',
};

function approxEqual(actual, expected, epsilon = 0.000001) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function trade(overrides = {}) {
  return {
    id: overrides.id ?? 1,
    username: 'ana',
    market_id: 10,
    exposure_group_id: 10,
    outcome_index: 0,
    side: 'buy',
    shares: 1000,
    collateral: 600,
    price_at_trade: 0.6,
    created_at: OPEN,
    tournament_featured: true,
    market_status: 'resolved',
    market_outcome: 0,
    market_start_time: OPEN,
    market_end_time: CLOSE,
    market_resolved_at: RESOLVED,
    pending_source_data: { touchMarket: false },
    ...overrides,
  };
}

function build(rows, marketPnl = 400) {
  return buildConvictionBonusByUser(rows, new Map([['ana:10', marketPnl]]), {
    window: OCTOBER_WINDOW,
  });
}

test('conviction multiplier reaches 1.5x for a lot bought at market open', () => {
  const result = tournamentConvictionMultiplierForLot(OPEN, OPEN, CLOSE);
  assert.equal(result.heldRatio, 1);
  assert.equal(result.multiplier, 1.5);
});

test('conviction bonus pays winning held lots and exposes audit stats', () => {
  const { bonusByUser, statsByUser, marketBreakdownByUser } = build([trade()]);
  approxEqual(bonusByUser.get('ana'), 200);
  assert.equal(statsByUser.get('ana').convictionMarkets, 1);
  assert.equal(statsByUser.get('ana').convictionLots, 1);
  approxEqual(statsByUser.get('ana').convictionBonusGross, 200);
  approxEqual(statsByUser.get('ana').convictionBonusCapApplied, 0);
  approxEqual(statsByUser.get('ana').convictionEligibleProfit, 400);
  approxEqual(marketBreakdownByUser.get('ana')[0].averageMultiplier, 1.5);
});

test('conviction bonus removes sold shares FIFO and ignores post-resolution redeems', () => {
  const { bonusByUser } = build([
    trade({ id: 1 }),
    trade({
      id: 2,
      shares: 1000,
      collateral: 600,
      price_at_trade: 0.6,
      created_at: HALF,
    }),
    trade({
      id: 3,
      side: 'sell',
      shares: 500,
      collateral: 350,
      price_at_trade: 0.7,
      created_at: '2026-10-20T06:00:00.000Z',
    }),
    trade({
      id: 4,
      side: 'redeem',
      shares: 1500,
      collateral: 1500,
      price_at_trade: 1,
      created_at: '2026-10-31T06:10:00.000Z',
    }),
  ], 1000);

  approxEqual(bonusByUser.get('ana'), 200);
});

test('conviction FIFO sells consume ineligible older lots before eligible later lots', () => {
  const { bonusByUser } = build([
    trade({
      id: 1,
      shares: 1000,
      collateral: 900,
      price_at_trade: 0.9,
      created_at: OPEN,
    }),
    trade({
      id: 2,
      shares: 1000,
      collateral: 600,
      price_at_trade: 0.6,
      created_at: '2026-10-02T06:00:00.000Z',
    }),
    trade({
      id: 3,
      side: 'sell',
      shares: 1000,
      collateral: 700,
      price_at_trade: 0.7,
      created_at: '2026-10-20T06:00:00.000Z',
    }),
  ], 1000);

  approxEqual(bonusByUser.get('ana'), 400 * 0.5 * (29 / 30));
});

test('conviction bonus requires price eligibility, resolved winner, and minimum market stake', () => {
  assert.equal(build([trade({ price_at_trade: 0.9, collateral: 900 })], 100).bonusByUser.get('ana'), undefined);
  assert.equal(build([trade({ market_outcome: 1 })], 400).bonusByUser.get('ana'), undefined);
  assert.equal(build([trade({ collateral: 90, shares: 150, price_at_trade: 0.6 })], 60).bonusByUser.get('ana'), undefined);
});

test('conviction bonus excludes touch markets and caps against net market pnl', () => {
  assert.equal(
    build([trade({ pending_source_data: { touchMarket: true } })], 400).bonusByUser.get('ana'),
    undefined,
  );

  const capped = build([trade()], 100);
  approxEqual(capped.bonusByUser.get('ana'), 50);
  approxEqual(capped.statsByUser.get('ana').convictionBonusGross, 200);
  approxEqual(capped.statsByUser.get('ana').convictionBonusCapApplied, 150);
});
