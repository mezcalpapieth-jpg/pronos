import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveMarketTags,
  matchesMarketTaxonomy,
} from './category-tags.js';

test('derives Mexico & Latam membership for Liga MX sports markets', () => {
  const tags = deriveMarketTags({
    category: 'deportes',
    sport: 'soccer',
    league: 'liga-mx',
    question: 'Cruz Azul vs Chivas',
  });

  assert.deepEqual(tags.categoryTags, ['deportes', 'mexico']);
  assert.deepEqual(tags.geoTags, ['mexico']);
  assert.deepEqual(tags.topicTags, ['deportes']);

  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'deportes' }, { category: 'deportes' }), true);
  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'deportes' }, { category: 'mexico' }), true);
  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'deportes' }, { category: 'mexico', geo: 'mexico', topic: 'deportes' }), true);
  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'deportes' }, { category: 'politica' }), false);
});

test('derives weather as a Mexico-only topic when the primary category is Mexico', () => {
  const tags = deriveMarketTags({
    category: 'mexico',
    resolver_type: 'weather_api',
    question: '¿CDMX supera 30°C mañana?',
    source_data: { city: 'CDMX' },
  });

  assert.deepEqual(tags.categoryTags, ['mexico']);
  assert.deepEqual(tags.geoTags, ['mexico']);
  assert.deepEqual(tags.topicTags, ['weather']);

  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'mexico' }, { category: 'mexico', geo: 'latam' }), false);
  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'mexico' }, { category: 'mexico', geo: 'mexico', topic: 'weather' }), true);
});

test('derives Latam geo membership from generator source metadata', () => {
  const tags = deriveMarketTags({
    category: 'politica',
    question: '¿Argentina aprueba la reforma antes de julio?',
    source_data: { region: 'latam' },
  });

  assert.deepEqual(tags.categoryTags, ['politica', 'mexico']);
  assert.deepEqual(tags.geoTags, ['latam']);
  assert.deepEqual(tags.topicTags, ['politica']);
});

test('keeps BTC and ETH 5-minute markets only in crypto despite CDMX wording', () => {
  const tags = deriveMarketTags({
    category: 'crypto',
    sport: 'crypto',
    question: 'Bitcoin: ¿sube o baja a las 12:05 CDMX?',
    resolver_config: { shape: 'binary-direction', asset: 'btc' },
  });

  assert.deepEqual(tags.categoryTags, ['crypto']);
  assert.deepEqual(tags.geoTags, []);
  assert.deepEqual(tags.topicTags, ['crypto']);

  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'crypto' }, { category: 'crypto' }), true);
  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'crypto' }, { category: 'mexico' }), false);
});

test('keeps World Cup markets only in the World Cup category', () => {
  const tags = deriveMarketTags({
    category: 'world-cup',
    sport: 'soccer',
    league: 'world-cup',
    question: 'México vs Alemania',
  });

  assert.deepEqual(tags.categoryTags, ['world-cup']);
  assert.deepEqual(tags.geoTags, []);
  assert.deepEqual(tags.topicTags, ['world-cup']);

  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'world-cup' }, { category: 'world-cup' }), true);
  assert.equal(matchesMarketTaxonomy({ ...tags, category: 'world-cup' }, { category: 'mexico' }), false);
});

test('honors explicit world region without inferring Mexico from the question', () => {
  const tags = deriveMarketTags({
    category: 'politica',
    question: '¿México firma un nuevo tratado global?',
    source_data: { marketRegion: 'world' },
  });

  assert.deepEqual(tags.categoryTags, ['politica']);
  assert.deepEqual(tags.geoTags, ['world']);
  assert.deepEqual(tags.topicTags, ['politica']);
});
