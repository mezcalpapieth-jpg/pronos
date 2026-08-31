import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateParlayMultiplier,
  normalizeParlayLegs,
  readParlayQuote,
} from './points-parlays.js';

function makeMarket(id, overrides = {}) {
  return {
    id,
    question: `Market ${id}`,
    status: 'active',
    outcome: null,
    outcomes: JSON.stringify(['Sí', 'No']),
    reserves: JSON.stringify([100, 100]),
    end_time: '2026-09-10T00:00:00.000Z',
    parent_id: null,
    exposure_group_id: id,
    tournament_featured: false,
    ...overrides,
  };
}

function fakeDb({ cycleRows = [], markets = [] } = {}) {
  return {
    async query(text, params = []) {
      const sql = String(text);
      if (sql.includes('FROM points_cycles')) {
        return { rows: cycleRows };
      }
      if (sql.includes('FROM points_markets m')) {
        const ids = new Set((params[0] || []).map(Number));
        return { rows: markets.filter(market => ids.has(Number(market.id))) };
      }
      throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

test('parlay multiplier discounts fair odds with configured factor', () => {
  const quote = calculateParlayMultiplier([0.5, 0.5, 0.5]);
  assert.equal(quote.fairMultiplier, 8);
  assert.equal(quote.multiplier, 6);
});

test('parlay multiplier caps tiny-price combinations', () => {
  const quote = calculateParlayMultiplier([0.01, 0.01, 0.01, 0.01, 0.01, 0.01]);
  assert.equal(quote.multiplier, 25);
});

test('parlay legs must be 3 to 6 distinct markets', () => {
  assert.throws(() => normalizeParlayLegs([{ marketId: 1, outcomeIndex: 0 }]), /not_enough_legs/);
  assert.throws(
    () => normalizeParlayLegs([
      { marketId: 1, outcomeIndex: 0 },
      { marketId: 1, outcomeIndex: 1 },
      { marketId: 2, outcomeIndex: 0 },
    ]),
    /duplicate_market/,
  );
});

test('parlay quote accepts active markets when no tournament cycle is active', async () => {
  const quote = await readParlayQuote(fakeDb({
    markets: [makeMarket(1), makeMarket(2), makeMarket(3)],
  }), {
    legs: [
      { marketId: 1, outcomeIndex: 0 },
      { marketId: 2, outcomeIndex: 0 },
      { marketId: 3, outcomeIndex: 0 },
    ],
    stake: 25,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.cycleId, null);
  assert.equal(quote.legs.length, 3);
});

test('parlay quote treats a finished scoring window as general combo mode', async () => {
  const quote = await readParlayQuote(fakeDb({
    cycleRows: [{
      id: 14,
      label: 'Ciclo cerrado',
      started_at: '2026-07-14T00:00:00.000Z',
      ends_at: '2026-07-28T00:00:00.000Z',
    }],
    markets: [makeMarket(11), makeMarket(12), makeMarket(13)],
  }), {
    legs: [
      { marketId: 11, outcomeIndex: 0 },
      { marketId: 12, outcomeIndex: 0 },
      { marketId: 13, outcomeIndex: 0 },
    ],
    stake: 25,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });

  assert.equal(quote.ok, true);
  assert.equal(quote.cycleId, null);
  assert.equal(quote.legs.length, 3);
});

test('parlay stake is capped by potential payout instead of a fixed 100 MXNP stake', async () => {
  const db = fakeDb({
    markets: [makeMarket(1), makeMarket(2), makeMarket(3)],
  });
  const allowed = await readParlayQuote(db, {
    legs: [
      { marketId: 1, outcomeIndex: 0 },
      { marketId: 2, outcomeIndex: 0 },
      { marketId: 3, outcomeIndex: 0 },
    ],
    stake: 800,
    now: new Date('2026-08-28T12:00:00.000Z'),
  });

  assert.equal(allowed.multiplier, 6);
  assert.equal(allowed.potentialPayout, 4800);

  await assert.rejects(
    () => readParlayQuote(db, {
      legs: [
        { marketId: 1, outcomeIndex: 0 },
        { marketId: 2, outcomeIndex: 0 },
        { marketId: 3, outcomeIndex: 0 },
      ],
      stake: 1000,
      now: new Date('2026-08-28T12:00:00.000Z'),
    }),
    /payout_too_high/,
  );
});
