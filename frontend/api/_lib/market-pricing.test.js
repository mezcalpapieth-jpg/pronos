import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachDefaultSuggestedPricing,
  attachSuggestedPricing,
  impliedProbabilitiesFromOdds,
  normalizeProbabilities,
  seedLiquiditiesFromProbabilities,
} from './market-pricing.js';

test('normalizeProbabilities accepts percentages and returns outcome-aligned pct', () => {
  const result = normalizeProbabilities([60, 40], 2);
  assert.deepEqual(result.probabilityPct, [60, 40]);
  assert.deepEqual(result.probabilities.map(v => Math.round(v * 100)), [60, 40]);
});

test('seedLiquiditiesFromProbabilities opens skewed CPMM odds with inverse reserves', () => {
  const result = seedLiquiditiesFromProbabilities([0.7, 0.3], { seedLiquidity: 1000 });
  assert.deepEqual(result.probabilityPct, [70, 30]);
  assert.deepEqual(result.seedLiquidities, [600, 1400]);
  assert.equal(result.seedLiquidity, 600);
});

test('impliedProbabilitiesFromOdds removes the bookmaker overround', () => {
  const result = impliedProbabilitiesFromOdds([1.5, 3], { format: 'decimal' });
  assert.deepEqual(result.probabilityPct, [66.7, 33.3]);
});

test('attachDefaultSuggestedPricing stores balanced pricing metadata on source_data', () => {
  const spec = attachDefaultSuggestedPricing({
    source: 'test',
    source_event_id: 'a',
    outcomes: ['A', 'B', 'C'],
    seed_liquidity: 900,
    source_data: { eventId: 'a' },
  });
  assert.deepEqual(spec.seed_liquidities, [900, 900, 900]);
  assert.deepEqual(spec.source_data.suggestedPricing.probabilityPct, [33.3, 33.3, 33.3]);
  assert.equal(spec.source_data.suggestedPricing.source, 'uniform-default');
});

test('attachSuggestedPricing preserves provider source and evidence', () => {
  const spec = attachSuggestedPricing({
    source: 'test',
    source_event_id: 'b',
    outcomes: ['Local', 'Visita'],
    seed_liquidity: 1000,
  }, {
    probabilities: [0.25, 0.75],
    source: 'provider',
    rationale: 'Provider consensus.',
    evidence: [{ bookmaker: 'Book', prices: [4, 1.3] }],
  });
  assert.deepEqual(spec.source_data.suggestedPricing.probabilityPct, [25, 75]);
  assert.deepEqual(spec.seed_liquidities, [1500, 500]);
  assert.equal(spec.seed_liquidity, 1000);
  assert.equal(spec.seedLiquidity, 1000);
  assert.equal(spec.source_data.suggestedPricing.source, 'provider');
  assert.equal(spec.source_data.suggestedPricing.evidence[0].bookmaker, 'Book');
});

test('attachSuggestedPricing preserves per-leg probabilities for parallel markets', () => {
  const spec = attachSuggestedPricing({
    source: 'test',
    source_event_id: 'parallel',
    outcomes: ['A', 'B', 'C'],
    seed_liquidity: 1000,
    amm_mode: 'parallel',
    source_data: {
      suggestedPricing: {
        legProbabilities: [0.32, 0.32, 0.32],
        legProbabilityPct: [32, 32, 32],
      },
    },
  }, {
    probabilities: [1 / 3, 1 / 3, 1 / 3],
    source: 'parallel-default',
  });
  assert.deepEqual(spec.seed_liquidities, [1000, 1000, 1000]);
  assert.deepEqual(spec.source_data.suggestedPricing.legProbabilityPct, [32, 32, 32]);
  assert.equal(spec.source_data.suggestedPricing.source, 'parallel-default');
});
