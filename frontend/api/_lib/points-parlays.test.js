import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateParlayMultiplier,
  normalizeParlayLegs,
} from './points-parlays.js';

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
