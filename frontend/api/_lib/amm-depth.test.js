/**
 * Run with:
 *   node --test frontend/api/_lib/amm-depth.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAmmDepth, buildMockMakerDepth } from './amm-depth.js';

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

test('buildMockMakerDepth creates seeded order-book rows without AMM depth', () => {
  const depth = buildMockMakerDepth({
    reserves: [500, 500],
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    seedLiquidity: 7500,
  });

  assert.equal(depth.currentPrice, 0.5);
  assert.equal(depth.perSideDepth, 7500);
  assert.equal(depth.asks.length, 4);
  assert.equal(depth.bids.length, 4);
  assert.ok(depth.asks.every(row => row.source === 'maker'));
  assert.ok(depth.bids.every(row => row.source === 'maker'));
  assert.ok(Math.abs(depth.asks.reduce((sum, row) => sum + row.total, 0) - 7500) < 0.01);
  assert.ok(Math.abs(depth.bids.reduce((sum, row) => sum + row.total, 0) - 7500) < 0.01);
});

test('buildMockMakerDepth defaults to lightweight maker depth', () => {
  const depth = buildMockMakerDepth({
    reserves: [500, 500],
    outcomeIndex: 0,
    levels: [10, 25, 50, 100],
    seedLiquidity: 250,
  });

  assert.equal(depth.currentPrice, 0.5);
  assert.equal(depth.perSideDepth, 500);
  assert.ok(Math.abs(depth.asks.reduce((sum, row) => sum + row.total, 0) - 500) < 0.01);
  assert.ok(Math.abs(depth.bids.reduce((sum, row) => sum + row.total, 0) - 500) < 0.01);
});

test('buildMockMakerDepth can anchor synthetic rows to displayed book-trade price', () => {
  const depth = buildMockMakerDepth({
    reserves: [500, 500],
    outcomeIndex: 1,
    levels: [10, 25, 50, 100],
    seedLiquidity: 500,
    currentPrice: 0.4,
  });

  assert.equal(depth.currentPrice, 0.4);
  assert.ok(Math.min(...depth.asks.map(row => row.price)) < 0.5);
  assert.ok(Math.max(...depth.bids.map(row => row.price)) < 0.4);
});
