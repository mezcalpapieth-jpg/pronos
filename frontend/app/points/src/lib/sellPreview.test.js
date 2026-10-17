import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSellPreview, normalizeSellShares } from './sellPreview.js';

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

test('buildSellPreview prorates position math for a partial early sell', () => {
  const preview = buildSellPreview(
    {
      shares: 100,
      costBasis: 80,
      currentValue: 120,
      pnl: 40,
    },
    {
      shares: 25,
      collateralOut: 28,
      priceBefore: 0.6,
      priceAfter: 0.57,
      priceImpactPts: -3,
    },
  );

  assert.equal(preview.shares, 25);
  assert.equal(preview.maxShares, 100);
  assert.equal(preview.sharePct, 25);
  assert.equal(preview.markValue, 30);
  assert.equal(preview.costBasis, 20);
  assert.equal(preview.markPnl, 10);
  assert.equal(preview.salePnl, 8);
  assert.equal(preview.slippageMxnp, -2);
  assert.equal(preview.minCollateralOut, 27.72);
});

test('normalizeSellShares clamps slider values to the held position', () => {
  assert.equal(normalizeSellShares({ shares: 10 }, 3.5), 3.5);
  assert.equal(normalizeSellShares({ shares: 10 }, 99), 10);
  assert.equal(normalizeSellShares({ shares: 10 }, -1), 0.01);
  assert.equal(normalizeSellShares({ shares: 0 }, 5), 0);
});

test('on-chain sell keeps six-decimal holdings and floors slippage without inventing post-trade prices', () => {
  const result = buildSellPreview({ mode: 'onchain', shares: 17.348493, costBasis: 8, currentValue: 8.7 },
    { shares: 17.348493, collateralOut: 8.769873, priceBefore: null, priceAfter: null });
  assert.equal(result.shares, 17.348493);
  assert.equal(result.collateralOut, 8.769873);
  assert.equal(result.minCollateralOut, 8.682174);
  assert.equal(result.priceBeforePct, null);
  assert.equal(result.priceAfterPct, null);
});

test('Points previews keep two-decimal payouts and do not show on-chain fee fields', () => {
  const result = buildSellPreview({ shares: 2, costBasis: 1, currentValue: 1.04 },
    { shares: 1, gross: 0.522535, fee: 0.013684, feePct: 2.6188, collateralOut: 0.508851 });
  assert.equal(result.collateralOut, 0.51);
  assert.equal(result.salePnl, 0.01);
  assert.equal(result.minCollateralOut, 0.5);
  assert.equal('fee' in result, false);
  assert.equal('gross' in result, false);
});
