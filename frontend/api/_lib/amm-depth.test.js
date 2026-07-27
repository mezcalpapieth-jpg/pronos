/**
 * Run with:
 *   node --test frontend/api/_lib/amm-depth.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAmmDepth } from './amm-depth.js';

test('buildAmmDepth derives executable bids and asks from binary AMM quotes', () => {
  const depth = buildAmmDepth({
    reserves: [500, 500],
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
  });

  assert.equal(depth.currentPrice, 0.5);
  assert.ok(depth.asks.length > 0);
  assert.ok(depth.bids.length > 0);
  assert.ok(depth.spread > 0);
  assert.ok(Math.min(...depth.asks.map(row => row.price)) > depth.currentPrice);
  assert.ok(Math.max(...depth.bids.map(row => row.price)) < depth.currentPrice);
});

test('buildAmmDepth supports unified multi-outcome markets', () => {
  const depth = buildAmmDepth({
    reserves: [500, 500, 500],
    outcomeIndex: 1,
    levels: [10, 25, 50],
  });

  assert.ok(depth.currentPrice > 0.32 && depth.currentPrice < 0.34);
  assert.equal(depth.asks.length, 3);
  assert.equal(depth.bids.length, 3);
  assert.ok(depth.asks.every(row => row.side === 'ask'));
  assert.ok(depth.bids.every(row => row.side === 'bid'));
});
