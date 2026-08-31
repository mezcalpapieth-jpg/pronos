import test from 'node:test';
import assert from 'node:assert/strict';
import { BANXICO_FIX_RESOLUTION_CRITERIA } from './banxico.js';
import { FRANKFURTER_SOURCE } from './frankfurter.js';
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

test('api price sync supports Frankfurter FX questions', () => {
  const result = syncApiPriceFromQuestion({
    question: 'EUR/MXN cierre del viernes > $21.50',
    resolverConfig: {
      source: FRANKFURTER_SOURCE,
      base: 'EUR',
      quote: 'MXN',
      pair: 'EUR/MXN',
      threshold: 21.25,
      op: 'lt',
      yesOutcome: 0,
    },
    sourceData: { strike: 21.25 },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.threshold, 21.5);
  assert.equal(result.resolverConfig.op, 'gt');
  assert.match(result.resolverConfig.criteria, /Frankfurter/);
  assert.equal(result.sourceData.strike, 21.5);
  assert.match(result.sourceData.resolutionCriteria, /EUR\/MXN/);
});

test('api price sync updates Chainlink crypto thresholds without explicit source', () => {
  const result = syncApiPriceFromQuestion({
    question: '¿BTC cerrará por encima de $78,000 USD el 26/08/2026?',
    resolverConfig: {
      feedAddress: '0x6ce185860a4963106506C203335A2910413708e9',
      chainId: 42161,
      symbol: 'BTC/USD',
      threshold: 80000,
      op: 'gt',
      yesOutcome: 0,
    },
    sourceData: { strike: 80000 },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.threshold, 78000);
  assert.equal(result.resolverConfig.op, 'gt');
  assert.equal(result.sourceData.strike, 78000);
});

test('api price sync updates Chainlink crypto thresholds with k suffixes', () => {
  const result = syncApiPriceFromQuestion({
    question: '¿BTC cerrará arriba de $78k USD el 26/08/2026?',
    resolverConfig: {
      feedAddress: '0x6ce185860a4963106506C203335A2910413708e9',
      chainId: 42161,
      symbol: 'BTC/USD',
      threshold: 80000,
      op: 'gt',
      yesOutcome: 0,
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.threshold, 78000);
  assert.equal(result.resolverConfig.op, 'gt');
});

test('api price sync preserves shorthand market-cap suffixes', () => {
  const result = syncApiPriceFromQuestion({
    question: '¿$DOGGY cerrará arriba de $130K de market cap el 23/08/2026?',
    resolverConfig: {
      source: 'coingecko-token-mcap',
      coinId: 'holder',
      threshold: 125000,
      op: 'gt',
      yesOutcome: 0,
    },
    sourceData: { strike: 125000 },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.threshold, 130000);
  assert.equal(result.resolverConfig.op, 'gt');
  assert.equal(result.sourceData.strike, 130000);
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
