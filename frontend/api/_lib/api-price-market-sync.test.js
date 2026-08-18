import test from 'node:test';
import assert from 'node:assert/strict';
import { BANXICO_FIX_RESOLUTION_CRITERIA } from './banxico.js';
import { syncApiPriceFromQuestion } from './api-price-market-sync.js';

test('api price sync turns edited USD/MXN below question into lt 17', () => {
  const result = syncApiPriceFromQuestion({
    question: 'El peso baja de $17.00 contra el dólar este viernes?',
    resolverConfig: {
      source: 'banxico-fix',
      seriesId: 'SF43718',
      threshold: 17.25,
      op: 'gt',
      yesOutcome: 0,
    },
    sourceData: { strike: 17.25 },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.threshold, 17);
  assert.equal(result.resolverConfig.op, 'lt');
  assert.equal(result.resolverConfig.criteria, BANXICO_FIX_RESOLUTION_CRITERIA);
  assert.equal(result.resolverConfig.rationale, BANXICO_FIX_RESOLUTION_CRITERIA);
  assert.equal(result.sourceData.strike, 17);
  assert.equal(result.sourceData.resolutionCriteria, BANXICO_FIX_RESOLUTION_CRITERIA);
});

test('api price sync keeps Meta above question as gt 610', () => {
  const result = syncApiPriceFromQuestion({
    question: '¿Meta cerrará por encima de $610 USD el viernes 14/08/2026?',
    resolverConfig: {
      source: 'finnhub',
      symbol: 'META',
      threshold: 600,
      op: 'gt',
      yesOutcome: 0,
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.threshold, 610);
  assert.equal(result.resolverConfig.op, 'gt');
});

test('api price sync ignores non-price resolvers', () => {
  const resolverConfig = { source: 'espn', threshold: 17.25, op: 'gt' };
  const result = syncApiPriceFromQuestion({
    question: 'El peso baja de $17.00 contra el dólar este viernes?',
    resolverConfig,
  });

  assert.equal(result.changed, false);
  assert.equal(result.resolverConfig, resolverConfig);
});
