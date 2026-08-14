import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_ENTERTAINMENT_TOPIC_FILTERS,
  ADMIN_GEO_FILTERS,
  ADMIN_MEXICO_TOPIC_FILTERS,
  CATEGORIES,
  MARKET_CREATION_GEO_OPTIONS,
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
    featureFilter: 'tournament',
  });

  assert.equal(q.toString(), 'status=all&category=mexico&feature=tournament&geo=mexico&topic=weather');
});

test('keeps world as a creation label but not a Mexico & Latam browse filter', () => {
  assert.deepEqual(ADMIN_GEO_FILTERS.map(g => g.key), ['all', 'mexico', 'latam']);
  assert.ok(MARKET_CREATION_GEO_OPTIONS.some(g => g.key === 'world' && g.label === 'Mundo'));
  assert.equal(
    buildAdminMarketsQuery({
      status: 'all',
      categoryFilter: 'mexico',
      geoFilter: 'world',
    }).toString(),
    'status=all&category=mexico',
  );
});

test('builds sports and crypto admin subfilter queries only in their parent categories', () => {
  assert.equal(
    buildAdminMarketsQuery({
      status: 'pending',
      categoryFilter: 'deportes',
      sportFilter: 'baseball',
      leagueFilter: 'mlb',
      cryptoTypeFilter: '5min',
      featureFilter: 'featured',
    }).toString(),
    'status=pending&category=deportes&feature=featured&sport=baseball&league=mlb',
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

test('exposes Spanish admin labels for new markets, creation world region, and weather topic', () => {
  assert.ok(CATEGORIES.some(c => c.key === 'world-cup' && c.label === 'Nuevos mercados'));
  assert.ok(CATEGORIES.some(c => c.key === 'musica' && c.label === 'Entretenimiento'));
  assert.ok(MARKET_CREATION_GEO_OPTIONS.some(c => c.key === 'world' && c.label === 'Mundo'));
  assert.ok(ADMIN_MEXICO_TOPIC_FILTERS.some(c => c.key === 'weather' && c.label === 'Clima'));
  assert.ok(ADMIN_ENTERTAINMENT_TOPIC_FILTERS.some(c => c.key === 'cine' && c.label === 'Cine'));
  assert.ok(ADMIN_ENTERTAINMENT_TOPIC_FILTERS.some(c => c.key === 'tv' && c.label === 'TV'));
  assert.ok(ADMIN_ENTERTAINMENT_TOPIC_FILTERS.some(c => c.key === 'farandula' && c.label === 'Farándula'));
});

test('builds entertainment admin subfilter queries under the legacy musica key', () => {
  assert.equal(
    buildAdminMarketsQuery({
      status: 'all',
      categoryFilter: 'musica',
      topicFilter: 'cine',
      geoFilter: 'mexico',
      sportFilter: 'soccer',
      featureFilter: 'tournament',
    }).toString(),
    'status=all&category=musica&feature=tournament&topic=cine',
  );
});
