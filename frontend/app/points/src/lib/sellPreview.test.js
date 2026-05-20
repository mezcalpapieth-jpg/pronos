import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSellPreview } from './sellPreview.js';

test('buildSellPreview shows realized sale math after AMM slippage', () => {
  const preview = buildSellPreview(
    {
      shares: 815.23,
      costBasis: 500,
      currentValue: 561.48,
      pnl: 61.48,
    },
    {
      collateralOut: 520,
      priceBefore: 0.69,
      priceAfter: 0.61,
      priceImpactPts: -8.1,
    },
  );

  assert.equal(preview.markValue, 561.48);
  assert.equal(preview.collateralOut, 520);
  assert.equal(preview.markPnl, 61.48);
  assert.equal(preview.salePnl, 20);
  assert.equal(preview.slippageMxnp, -41.48);
  assert.equal(preview.slippagePct, -7.39);
  assert.equal(preview.priceBeforePct, 69);
  assert.equal(preview.priceAfterPct, 61);
  assert.equal(preview.priceImpactPts, -8.1);
  assert.equal(preview.minCollateralOut, 514.8);
});

test('buildSellPreview guards empty quotes without showing NaN', () => {
  const preview = buildSellPreview(
    { shares: 10, costBasis: 0, currentValue: 0, pnl: 0 },
    { collateralOut: 0 },
  );

  assert.equal(preview.markValue, 0);
  assert.equal(preview.collateralOut, 0);
  assert.equal(preview.salePnl, 0);
  assert.equal(preview.slippageMxnp, 0);
  assert.equal(preview.slippagePct, 0);
  assert.equal(preview.minCollateralOut, 0);
});
