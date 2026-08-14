import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MVP_PUBLIC_GEO_FILTERS,
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from './mvpCategoryFilters.js';

test('MVP category filters use tag taxonomy without folding World Cup into Mexico', () => {
  assert.equal(
    marketInCategory({ category: 'politica', categoryTags: ['mexico'] }, 'mexico'),
    true,
  );
  assert.equal(
    marketInCategory({ category: 'world-cup', categoryTags: ['world-cup'], geoTags: [] }, 'mexico'),
    false,
  );
});

test('MVP geo and topic filters match points public filters', () => {
  const weatherMarket = {
    category: 'mexico',
    categoryTags: ['mexico'],
    geoTags: ['latam'],
    topicTags: ['weather'],
  };

  assert.deepEqual(MVP_PUBLIC_GEO_FILTERS.map(g => g.key), ['all', 'mexico', 'latam']);
  assert.equal(marketInGeo(weatherMarket, 'latam'), true);
  assert.equal(marketInGeo(weatherMarket, 'mexico'), false);
  assert.equal(marketInTopic(weatherMarket, 'weather'), true);
  assert.equal(marketInTopic(weatherMarket, 'deportes'), false);
});

test('MVP public filters treat legacy Copa Libertadores markets as Latam sports', () => {
  const libertadoresMarket = {
    category: 'deportes',
    sport: 'soccer',
    league: 'copa-libertadores',
    categoryTags: [],
    geoTags: [],
    topicTags: [],
  };

  assert.equal(marketInCategory(libertadoresMarket, 'mexico'), true);
  assert.equal(marketInGeo(libertadoresMarket, 'latam'), true);
  assert.equal(marketInTopic(libertadoresMarket, 'deportes'), true);
});
