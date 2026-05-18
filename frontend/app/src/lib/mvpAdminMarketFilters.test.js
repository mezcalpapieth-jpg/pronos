import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_CRYPTO_FILTERS,
  ADMIN_GEO_FILTERS,
  ADMIN_MEXICO_TOPIC_FILTERS,
  ADMIN_SPORT_FILTERS,
  CATEGORIES,
  MARKET_CREATION_GEO_OPTIONS,
  filterProtocolAdminMarkets,
} from './mvpAdminMarketFilters.js';

test('MVP admin categories are text-only and expose subcategory controls', () => {
  assert.ok(CATEGORIES.some(c => c.key === 'mexico' && c.label === 'Mexico & Latam'));
  assert.ok(CATEGORIES.every(c => !('icon' in c)), 'admin category labels should not carry emoji fields');
  assert.deepEqual(ADMIN_GEO_FILTERS.map(g => g.key), ['all', 'mexico', 'latam']);
  assert.ok(MARKET_CREATION_GEO_OPTIONS.some(g => g.key === 'world' && g.label === 'Mundo'));
  assert.ok(ADMIN_MEXICO_TOPIC_FILTERS.some(t => t.key === 'weather' && t.label === 'Clima'));
  assert.ok(ADMIN_SPORT_FILTERS.some(s => s.key === 'combate'));
  assert.ok(ADMIN_CRYPTO_FILTERS.some(c => c.key === '5min'));
});

test('MVP admin market filters include Mexico and Latam tag subcategories', () => {
  const rows = [
    {
      id: 'mx-weather',
      category: 'mexico',
      categoryTags: ['mexico'],
      geoTags: ['mexico'],
      topicTags: ['weather'],
    },
    {
      id: 'latam-sports',
      category: 'deportes',
      categoryTags: ['deportes', 'mexico'],
      geoTags: ['latam'],
      topicTags: ['deportes'],
      sport: 'soccer',
      league: 'liga-mx',
    },
    {
      id: 'crypto-5m',
      category: 'crypto',
      categoryTags: ['crypto'],
      crypto5min: true,
    },
  ];

  assert.deepEqual(
    filterProtocolAdminMarkets(rows, {
      categoryFilter: 'mexico',
      geoFilter: 'latam',
      topicFilter: 'deportes',
    }).map(m => m.id),
    ['latam-sports'],
  );

  assert.deepEqual(
    filterProtocolAdminMarkets(rows, {
      categoryFilter: 'deportes',
      sportFilter: 'soccer',
      leagueFilter: 'liga-mx',
    }).map(m => m.id),
    ['latam-sports'],
  );

  assert.deepEqual(
    filterProtocolAdminMarkets(rows, {
      categoryFilter: 'crypto',
      cryptoTypeFilter: '5min',
    }).map(m => m.id),
    ['crypto-5m'],
  );
});
