import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSeedLiquidities,
  defaultPointsSeedLiquidity,
  seedLiquiditiesFromRow,
} from './market-liquidity.js';

test('Points opening defaults are 25% lower, with non-sports at half, independent of trophy or date', () => {
  for (const [outcomeCount, ammMode, previousSports] of [[2,'unified',5000], [3,'unified',10000], [8,'unified',20000], [8,'parallel',5000]]) {
    const sports = previousSports * 0.75;
    assert.equal(defaultPointsSeedLiquidity({ category: 'deportes', outcomeCount, ammMode }), sports);
    for (const category of ['crypto','finanzas','mexico','ai']) {
      assert.equal(defaultPointsSeedLiquidity({ category, outcomeCount, ammMode }), sports / 2);
    }
  }
});

test('normalizeSeedLiquidities defaults to 500 per option', () => {
  const result = normalizeSeedLiquidities({ outcomes: ['PSG', 'Arsenal'] });
  assert.deepEqual(result.values, [500, 500]);
  assert.equal(result.fallback, 500);
  assert.equal(result.total, 1000);
  assert.equal(result.uniform, true);
});

test('normalizeSeedLiquidities accepts asymmetric per-option liquidity', () => {
  const result = normalizeSeedLiquidities({
    outcomes: ['A', 'B', 'C'],
    seedLiquidities: [500, 800, '1200'],
  });
  assert.deepEqual(result.values, [500, 800, 1200]);
  assert.equal(result.fallback, 500);
  assert.equal(result.total, 2500);
  assert.equal(result.uniform, false);
});

test('normalizeSeedLiquidities rejects mismatched or too-small values', () => {
  assert.equal(
    normalizeSeedLiquidities({ outcomes: ['A', 'B'], seedLiquidities: [500] }).error,
    'seed_liquidities_length_mismatch',
  );
  assert.equal(
    normalizeSeedLiquidities({ outcomes: ['A', 'B'], seedLiquidities: [99, 500] }).error,
    'seed_too_small',
  );
});

test('seedLiquiditiesFromRow reads jsonb strings and falls back to scalar rows', () => {
  assert.deepEqual(
    seedLiquiditiesFromRow({ seed_liquidities: '[700,900]', seed_liquidity: 500 }, ['A', 'B']),
    [700, 900],
  );
  assert.deepEqual(
    seedLiquiditiesFromRow({ seed_liquidity: 750 }, ['A', 'B', 'C']),
    [750, 750, 750],
  );
});
