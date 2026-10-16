import test from 'node:test';
import assert from 'node:assert/strict';

import {
  attachDefaultSuggestedPricing,
  attachSuggestedPricing,
  attachUniformGeneratedPricing,
  attachGeneratedPointsLiquidity,
  attachPointsOpeningLiquidity,
  impliedProbabilitiesFromOdds,
  normalizeProbabilities,
  seedLiquiditiesFromProbabilities,
} from './market-pricing.js';

test('normalizeProbabilities accepts percentages and returns outcome-aligned pct', () => {
  const result = normalizeProbabilities([60, 40], 2);
  assert.deepEqual(result.probabilityPct, [60, 40]);
  assert.deepEqual(result.probabilities.map(v => Math.round(v * 100)), [60, 40]);
});

test('Points generator reserves use reduced type-specific floors without changing opening odds', () => {
  const tournament = { category: 'deportes', tournament_featured: true, end_time: '2026-10-25T18:00:00Z' };
  const options = { now: new Date('2026-10-15T12:00:00Z') };
  for (const [count, mode, expected] of [[2, 'unified', 3750], [3, 'unified', 7500], [7, 'unified', 15000], [9, 'parallel', 3750]]) {
    const original = { ...tournament, outcomes: Array.from({ length: count }, (_, i) => `Option ${i}`), amm_mode: mode, seed_liquidity: 1000 };
    const priced = attachGeneratedPointsLiquidity(original, options);
    assert.deepEqual(priced.seed_liquidities, Array(count).fill(expected));
    assert.equal(priced.seed_liquidity, expected);
    assert.equal(original.seed_liquidity, 1000);
    if (mode === 'parallel') assert.deepEqual(priced.source_data.suggestedPricing.legProbabilities, Array(count).fill(0.5));
    else assert.ok(priced.source_data.suggestedPricing.probabilities.every(p => Math.abs(p - 1 / count) < 1e-12));
    assert.deepEqual(attachGeneratedPointsLiquidity(priced, options), priced);
    assert.equal(attachGeneratedPointsLiquidity({ ...original, category: 'finanzas' }, options).seed_liquidity, expected / 2);
  }
  assert.equal(attachGeneratedPointsLiquidity({ ...tournament, outcomes: ['Yes', 'No'], seed_liquidity: 25000 }, options).seed_liquidity, 25000);
  assert.equal(attachUniformGeneratedPricing({ outcomes: ['Yes', 'No'], seed_liquidity: 1000 }).seed_liquidity, 1000);
  assert.equal(attachGeneratedPointsLiquidity({ ...tournament, tournament_featured: false, outcomes: ['Yes', 'No'], seed_liquidity: 1000 }, options).seed_liquidity, 3750);
  for (const end_time of [null, '2026-09-01T18:00:00Z', '2026-11-05T18:00:00Z']) {
    assert.equal(attachGeneratedPointsLiquidity({ ...tournament, end_time, outcomes: ['Yes', 'No'], seed_liquidity: 1000 }, options).seed_liquidity, 3750);
  }
  assert.equal(attachGeneratedPointsLiquidity({ ...tournament, outcomes: ['Yes', 'No'], seed_liquidity: 1000 }, { now: new Date('2026-11-02') }).seed_liquidity, 3750);
});

test('legacy pending defaults gain depth without changing custom pricing or touching live/onchain rows', () => {
  const row = { status: 'pending', category: 'crypto', outcomes: ['Up', 'Down'],
    seed_liquidity: 1000, seed_liquidities: [1000,1000], tournament_featured: false,
    source_data: { sourceEvidence: 'preserved', suggestedPricing: {
      legProbabilities: [0.3,0.7], legProbabilityPct: [30,70], seedLiquidities: [1000,1000],
    } } };
  const priced = attachPointsOpeningLiquidity(row);
  assert.deepEqual(priced.seed_liquidities, [1875,1875]);
  assert.deepEqual(priced.source_data.suggestedPricing.legProbabilities, [0.3,0.7]);
  assert.equal(priced.source_data.sourceEvidence, 'preserved');
  assert.deepEqual(priced.source_data.suggestedPricing.seedLiquidities, [1875,1875]);
  assert.deepEqual(attachPointsOpeningLiquidity(priced), priced);
  for (const patch of [{ status: 'active' }, { status: 'approved' }, { mode: 'onchain' },
    { chain_id: 42161 }, { chain_address: '0xabc' }, { seed_liquidities: [1000,2000] }]) {
    const custom = { ...row, ...patch };
    assert.deepEqual(attachPointsOpeningLiquidity(custom), custom);
  }
  assert.deepEqual(attachPointsOpeningLiquidity({ ...row, seed_liquidity: 12000,
    seed_liquidities: [12000,12000] }).seed_liquidities, [12000,12000]);
  assert.deepEqual(row.seed_liquidities, [1000,1000]);
});

test('lower opening defaults do not reduce explicitly configured pending seeds', () => {
  const pending = { status: 'pending', category: 'deportes', outcomes: ['A', 'B'],
    seed_liquidity: 5000, seed_liquidities: [5000,5000] };
  assert.deepEqual(attachPointsOpeningLiquidity(pending).seed_liquidities, [5000,5000]);
});

test('seedLiquiditiesFromProbabilities opens skewed CPMM odds with inverse reserves', () => {
  const result = seedLiquiditiesFromProbabilities([0.7, 0.3], { seedLiquidity: 1000 });
  assert.deepEqual(result.probabilityPct, [70, 30]);
  assert.deepEqual(result.seedLiquidities, [600, 1400]);
  assert.equal(result.seedLiquidity, 600);
});

test('seedLiquiditiesFromProbabilities can floor thin longshot reserves without changing odds', () => {
  const result = seedLiquiditiesFromProbabilities([0.055, 0.945], {
    seedLiquidity: 876.51,
    minProbability: 0.01,
    minOutcomeReserve: 1000,
  });
  const [yesReserve, noReserve] = result.seedLiquidities;
  const yesPrice = noReserve / (yesReserve + noReserve);

  assert.equal(Math.min(...result.seedLiquidities), 1000);
  assert.ok(yesReserve > 10_000);
  assert.ok(Math.abs(yesPrice - result.probabilities[0]) < 0.001);
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

test('attachUniformGeneratedPricing opens generated parallel legs at 50/50', () => {
  const spec = attachUniformGeneratedPricing({
    source: 'test',
    source_event_id: 'parallel-generated',
    outcomes: ['A', 'B', 'C'],
    seed_liquidity: 1000,
    amm_mode: 'parallel',
    source_data: {
      suggestedPricing: {
        source: 'source-signals:test',
        probabilities: [0.7, 0.2, 0.1],
        probabilityPct: [70, 20, 10],
        legProbabilityPct: [70, 20, 10],
      },
    },
  });

  assert.deepEqual(spec.seed_liquidities, [1000, 1000, 1000]);
  assert.deepEqual(spec.source_data.suggestedPricing.probabilityPct, [33.3, 33.3, 33.3]);
  assert.deepEqual(spec.source_data.suggestedPricing.legProbabilityPct, [50, 50, 50]);
  assert.equal(spec.source_data.suggestedPricing.source, 'uniform-generated');
});
