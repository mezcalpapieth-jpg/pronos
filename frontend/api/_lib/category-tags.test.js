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
