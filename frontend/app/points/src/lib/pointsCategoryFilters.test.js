import test from 'node:test';
import assert from 'node:assert/strict';

import {
  marketInCategory,
  marketInGeo,
  marketInTopic,
} from './pointsCategoryFilters.js';

test('matches public category membership through primary category or category tags', () => {
  assert.equal(marketInCategory({ category: 'politica', categoryTags: ['mexico'] }, 'mexico'), true);
  assert.equal(marketInCategory({ category: 'crypto', categoryTags: ['crypto'] }, 'mexico'), false);
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
  assert.equal(marketInGeo(worldMarket, 'world'), true);
});
