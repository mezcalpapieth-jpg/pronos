/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.leg-buy.test.js
 *
 * Regression guard for parallel markets: the Sí/No buttons under the
 * chart hand handleBuyClick a leg market that the component builds on
 * the fly. When that object omitted status/seriesLocked, the gating
 * check read it as inactive and swallowed every click — the market
 * looked live but no option could be entered.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');

test('synthetic leg market carries the gating fields handleBuyClick checks', () => {
  const legMarket = detailSource.match(/const legMarket = \{[\s\S]*?\};/);
  assert.ok(legMarket, 'expected ParallelLegList to build a legMarket');
  assert.match(legMarket[0], /status: leg\.status \?\? market\.status/);
  assert.match(legMarket[0], /seriesLocked: leg\.seriesLocked \?\? market\.seriesLocked/);
});

test('"buy more" target for a parallel position carries gating fields', () => {
  const buyTarget = detailSource.match(/const buyTarget = p\.parentMarketId[\s\S]*?: market;/);
  assert.ok(buyTarget, 'expected a buyTarget for position rows');
  assert.match(buyTarget[0], /status: positionLeg\?\.status \?\? market\.status/);
  assert.match(buyTarget[0], /seriesLocked: positionLeg\?\.seriesLocked \?\? market\.seriesLocked/);
});

test('handleBuyClick falls back to the parent status instead of blocking', () => {
  const handler = detailSource.match(/function handleBuyClick\([\s\S]*?\n  \}/);
  assert.ok(handler, 'expected handleBuyClick');
  assert.match(handler[0], /const targetStatus = lockTarget\?\.status \?\? market\?\.status/);
  assert.match(handler[0], /targetStatus !== 'active'/);
  assert.doesNotMatch(
    handler[0],
    /lockTarget\?\.status !== 'active'/,
    'a target without a status must not be treated as inactive',
  );
});

test('parallel detail sinks resolved loser legs and renders them read-only at zero', () => {
  assert.match(detailSource, /function parallelLegYesPrice/);
  assert.match(detailSource, /if \(resolvedOutcome === 1\) return 0/);
  assert.match(detailSource, /function sortParallelDisplayLegs/);
  assert.match(detailSource, /parallelLegYesPrice\(b\) - parallelLegYesPrice\(a\)/);
  assert.match(detailSource, /const parallelDisplayLegs = market\.ammMode === 'parallel'/);
  assert.match(detailSource, /legs=\{parallelDisplayLegs \|\| market\.legs\}/);
  assert.match(detailSource, /const isLegTradable = parallelLegIsTradable\(leg, market\)/);
  assert.match(detailSource, /Eliminado · 0%/);
  assert.match(detailSource, /function chartOutcomeIndicesForDisplay/);
  assert.match(detailSource, /Number\(parallelDisplayLegs\[i\]\?\.outcome\) === 1/);
  assert.match(detailSource, /return selected\.slice\(0, 6\)/);
});

test('parallel order book only exposes tradable child legs', () => {
  const optionsBuilder = detailSource.match(/function buildOrderBookOptions\([\s\S]*?\n\}/);
  assert.ok(optionsBuilder, 'expected buildOrderBookOptions');
  assert.match(optionsBuilder[0], /parallelDisplayLegs/);
  assert.match(optionsBuilder[0], /\.filter\(leg => parallelLegIsTradable\(leg, market\)\)/);
  assert.match(detailSource, /parallelDisplayLegs=\{parallelDisplayLegs\}/);
});
