import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PUBLIC_GEO_FILTERS,
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from './pointsCategoryFilters.js';

test('matches public category membership through primary category or category tags', () => {
  assert.equal(marketInCategory({ category: 'politica', categoryTags: ['mexico'] }, 'mexico'), true);
  assert.equal(marketInCategory({ category: 'crypto', categoryTags: ['crypto'] }, 'mexico'), false);
});

test('new markets public slug matches legacy world-cup category rows', () => {
  assert.equal(marketInCategory({ category: 'world-cup', categoryTags: ['world-cup'] }, 'nuevos-mercados'), true);
  assert.equal(marketInCategory({ category: 'nuevos-mercados', categoryTags: [] }, 'nuevos-mercados'), true);
  assert.equal(marketInCategory({ category: 'world-cup', categoryTags: ['world-cup'] }, 'mexico'), false);
});

test('matches public geo and topic subfilters from derived market tags', () => {
  const weatherMarket = {
    category: 'mexico',
    categoryTags: ['mexico'],
    geoTags: ['mexico'],
    topicTags: ['weather'],
  };
  const worldMarket = {
    category: 'politica',
    categoryTags: ['politica'],
    geoTags: ['world'],
    topicTags: ['politica'],
  };

  assert.equal(marketInGeo(weatherMarket, 'mexico'), true);
  assert.equal(marketInGeo(weatherMarket, 'latam'), false);
  assert.equal(marketInTopic(weatherMarket, 'weather'), true);
  assert.equal(marketInGeo(worldMarket, 'world'), false);
});

test('public geo filters do not expose world as a Mexico and Latam subcategory', () => {
  assert.deepEqual(PUBLIC_GEO_FILTERS.map(g => g.key), ['all', 'mexico', 'latam']);
});

test('points public filters treat legacy Copa Libertadores markets as Latam sports', () => {
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
