import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DEPTH_LEVELS,
  buildAmmDepth,
  normalizeDepthLevels,
} from './protocol-depth.js';

test('normalizeDepthLevels keeps a small positive AMM ladder with safe defaults', () => {
  assert.deepEqual(DEFAULT_DEPTH_LEVELS, [10, 25, 50, 100]);
  assert.deepEqual(normalizeDepthLevels(null), DEFAULT_DEPTH_LEVELS);
  assert.deepEqual(
    normalizeDepthLevels('5,10,25,50,100,250,bad,-1,0'),
    [5, 10, 25, 50, 100],
  );
  assert.deepEqual(normalizeDepthLevels([0, '12.5', Infinity, 40, 40, 75]), [12.5, 40, 75]);
});

test('buildAmmDepth creates buy and sell ladders from read-only quote functions', async () => {
  const buyCalls = [];
  const sellCalls = [];

  const depth = await buildAmmDepth({
    market: { chain_address: '0xPool', outcomes: ['PSG', 'Arsenal'] },
    outcomeIndex: 0,
    levels: [10, 25],
    quoteBuy: async ({ collateral, outcomeIndex }) => {
      buyCalls.push({ collateral, outcomeIndex });
      return {
        collateral,
        fee: collateral * 0.02,
        sharesOut: collateral * 2,
        avgPrice: 0.5,
        currentPrice: 0.4,
        priceImpactPts: collateral / 10,
      };
    },
    quoteSell: async ({ shares, outcomeIndex }) => {
      sellCalls.push({ shares, outcomeIndex });
      return {
        shares,
        collateralOut: shares * 0.38,
        currentPrice: 0.4,
        priceImpactPts: -shares / 100,
      };
    },
  });

  assert.equal(depth.outcomeIndex, 0);
  assert.deepEqual(depth.levels, [10, 25]);
  assert.deepEqual(buyCalls, [
    { collateral: 10, outcomeIndex: 0 },
    { collateral: 25, outcomeIndex: 0 },
  ]);
  assert.deepEqual(sellCalls, [
    { shares: 25, outcomeIndex: 0 },
    { shares: 62.5, outcomeIndex: 0 },
  ]);
  assert.deepEqual(depth.buy[0], {
    side: 'buy',
    notional: 10,
    collateral: 10,
    fee: 0.2,
    sharesOut: 20,
    avgPrice: 0.5,
    currentPrice: 0.4,
    priceImpactPts: 1,
  });
  assert.deepEqual(depth.sell[0], {
    side: 'sell',
    notional: 10,
    shares: 25,
    collateralOut: 9.5,
    avgPrice: 0.38,
    currentPrice: 0.4,
    priceImpactPts: -0.25,
  });
});

test('buildAmmDepth returns row-level quote errors instead of hiding the ladder', async () => {
  const depth = await buildAmmDepth({
    market: { chain_address: '0xPool', outcomes: ['Sí', 'No'] },
    outcomeIndex: 1,
    levels: [10],
    quoteBuy: async () => {
      throw Object.assign(new Error('quote_failed'), { status: 503 });
    },
    quoteSell: async () => {
      throw Object.assign(new Error('sell_quote_failed'), { status: 503 });
    },
  });

  assert.equal(depth.buy[0].side, 'buy');
  assert.equal(depth.buy[0].notional, 10);
  assert.equal(depth.buy[0].error, 'quote_failed');
  assert.equal(depth.sell[0].side, 'sell');
  assert.equal(depth.sell[0].notional, 10);
  assert.equal(depth.sell[0].error, 'sell_quote_failed');
});
