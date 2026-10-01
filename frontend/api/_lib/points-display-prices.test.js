import test from 'node:test';
import assert from 'node:assert/strict';

import { pricesWithBookTrades } from './points-display-prices.js';

test('multi-outcome book fills update traded outcomes and keep prices normalized', () => {
  const prices = pricesWithBookTrades([1 / 3, 1 / 3, 1 / 3], {
    status: 'active',
    trades: [
      { outcomeIndex: 0, price: 0.38, isBookTrade: true, lastAtMs: 2 },
      { outcomeIndex: 2, price: 0.37, isBookTrade: true, lastAtMs: 1 },
    ],
  });

  assert.equal(prices.length, 3);
  assert.equal(Math.round(prices[0] * 100), 38);
  assert.equal(Math.round(prices[2] * 100), 37);
  assert.equal(Math.round(prices[1] * 100), 25);
  assert.ok(Math.abs(prices.reduce((sum, price) => sum + price, 0) - 1) < 0.000001);
});

test('multi-outcome book display ignores non-book trades and inactive markets', () => {
  const base = [0.2, 0.3, 0.5];
  assert.deepEqual(pricesWithBookTrades(base, {
    status: 'active',
    trades: [{ outcomeIndex: 1, price: 0.8, isBookTrade: false }],
  }), base);
  assert.deepEqual(pricesWithBookTrades(base, {
    status: 'resolved',
    trades: [{ outcomeIndex: 1, price: 0.8, isBookTrade: true }],
  }), base);
});
