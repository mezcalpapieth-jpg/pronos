import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_GEO_FILTERS,
  ADMIN_MEXICO_TOPIC_FILTERS,
  CATEGORIES,
  buildAdminMarketsQuery,
  formatAdminMarketDate,
} from './adminMarketFilters.js';

test('builds admin markets query with Mexico & Latam subfilters', () => {
  const q = buildAdminMarketsQuery({
    status: 'all',
    categoryFilter: 'mexico',
    geoFilter: 'mexico',
    topicFilter: 'weather',
    sportFilter: 'soccer',
    leagueFilter: 'liga-mx',
    cryptoTypeFilter: '5min',
  });

  assert.equal(q.toString(), 'status=all&category=mexico&geo=mexico&topic=weather');
});

test('builds sports and crypto admin subfilter queries only in their parent categories', () => {
  assert.equal(
    buildAdminMarketsQuery({
      status: 'pending',
      categoryFilter: 'deportes',
      sportFilter: 'baseball',
      leagueFilter: 'mlb',
      cryptoTypeFilter: '5min',
    }).toString(),
    'status=pending&category=deportes&sport=baseball&league=mlb',
  );

  assert.equal(
    buildAdminMarketsQuery({
      status: 'resolved',
      categoryFilter: 'crypto',
      sportFilter: 'nba',
      cryptoTypeFilter: 'general',
    }).toString(),
    'status=resolved&category=crypto&crypto_type=general',
  );
});

test('formats admin market dates without relying on component-local helpers', () => {
  assert.equal(formatAdminMarketDate(null), '-');
  assert.match(formatAdminMarketDate('2026-05-15T18:30:00.000Z'), /\d{2}/);
});

test('exposes Spanish admin labels for World Cup, world region, and weather topic', () => {
  assert.ok(CATEGORIES.some(c => c.key === 'world-cup' && c.label === 'Copa del Mundo'));
  assert.ok(ADMIN_GEO_FILTERS.some(c => c.key === 'world' && c.label === 'Mundo'));
  assert.ok(ADMIN_MEXICO_TOPIC_FILTERS.some(c => c.key === 'weather' && c.label === 'Clima'));
});
