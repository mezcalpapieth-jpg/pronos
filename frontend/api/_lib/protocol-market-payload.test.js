import test from 'node:test';
import assert from 'node:assert/strict';

import { buildProtocolMarketPayload } from './protocol-market-payload.js';

test('buildProtocolMarketPayload merges approved points metadata into on-chain market payloads', () => {
  const market = buildProtocolMarketPayload({
    id: 7,
    market_id: 3,
    pool_address: '0xPool',
    factory_address: '0xFactory',
    chain_id: 42161,
    question: '¿Quién gana Marlon Vera vs Sean OMalley?',
    category: 'deportes',
    outcomes: ['Marlon Vera', 'Sean OMalley'],
    outcome_count: 2,
    protocol_version: 'v2',
    start_time: '2026-05-20T02:00:00.000Z',
    end_time: '2026-05-20T05:00:00.000Z',
    status: 'active',
    outcome: null,
    seed_liquidity: '1000',
    tx_hash: '0xabc',
    created_at: '2026-05-15T00:00:00.000Z',
    resolved_at: null,
    s_prices: ['0.58', '0.42'],
    s_liquidity: '2100',
    s_volume: '120',
    s_snapshot: '2026-05-15T00:01:00.000Z',
    meta_sport: 'combate',
    meta_league: 'ufc',
    meta_outcome_images: ['vera.png', 'omalley.png'],
    meta_geo_tags: ['latam'],
    meta_category_tags: ['deportes', 'mexico'],
    meta_topic_tags: ['deportes'],
    meta_source_data: {
      fighters: [
        { name: 'Marlon Vera', country: 'Ecuador' },
        { name: 'Sean OMalley', country: 'United States' },
      ],
    },
  });

  assert.equal(market.mode, 'onchain');
  assert.equal(market.sport, 'combate');
  assert.equal(market.league, 'ufc');
  assert.deepEqual(market.prices, [0.58, 0.42]);
  assert.deepEqual(market.outcomeImages, ['vera.png', 'omalley.png']);
  assert.deepEqual(market.geoTags, ['latam']);
  assert.deepEqual(market.outcomeCountryLabels, ['Ecuador', null]);
});

test('buildProtocolMarketPayload keeps World Cup isolated from Mexico taxonomy', () => {
  const market = buildProtocolMarketPayload({
    id: 9,
    market_id: 4,
    pool_address: '0xPool',
    factory_address: '0xFactory',
    chain_id: 42161,
    question: '¿México gana la Copa del Mundo 2026?',
    category: 'world-cup',
    outcomes: ['Sí', 'No'],
    outcome_count: 2,
    protocol_version: 'v1',
    end_time: '2026-07-19T23:00:00.000Z',
    status: 'active',
    seed_liquidity: '1000',
    s_yes: '0.35',
    s_no: '0.65',
  });

  assert.equal(market.category, 'world-cup');
  assert.deepEqual(market.categoryTags, ['world-cup']);
  assert.deepEqual(market.geoTags, []);
  assert.equal(market.crypto5min, false);
});

test('buildProtocolMarketPayload exposes admin-featured protocol markets as trending', () => {
  const market = buildProtocolMarketPayload({
    id: 12,
    market_id: 5,
    pool_address: '0xPool',
    factory_address: '0xFactory',
    chain_id: 42161,
    question: '¿Arsenal gana su siguiente partido?',
    category: 'deportes',
    outcomes: ['Sí', 'No'],
    outcome_count: 2,
    protocol_version: 'v1',
    start_time: '2026-05-21T18:00:00.000Z',
    end_time: '2026-05-21T20:00:00.000Z',
    status: 'active',
    featured: true,
    seed_liquidity: '1000',
    s_yes: '0.52',
    s_no: '0.48',
  });

  assert.equal(market.featured, true);
  assert.equal(market.trending, true);
});

test('buildProtocolMarketPayload exposes ESPN playoff series metadata for MVP detail', () => {
  const market = buildProtocolMarketPayload({
    id: 11,
    market_id: 8,
    pool_address: '0xPool',
    factory_address: '0xFactory',
    chain_id: 42161,
    question: '¿Quién gana San Antonio Spurs @ Oklahoma City Thunder?',
    category: 'deportes',
    outcomes: ['Oklahoma City Thunder', 'San Antonio Spurs'],
    outcome_count: 2,
    protocol_version: 'v2',
    start_time: '2026-05-19T00:30:00.000Z',
    end_time: '2026-05-19T03:30:00.000Z',
    status: 'active',
    seed_liquidity: '1000',
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'espn',
      leaguePath: 'basketball/nba',
      shape: 'binary',
      series: {
        key: 'basketball-nba:2026:series:24-25',
        leaguePath: 'basketball/nba',
        league: 'nba',
        sport: 'nba',
        gameNumber: 1,
        bestOf: 7,
        winTarget: 4,
        guaranteedGames: 4,
        seasonYear: 2026,
        homeTeam: { id: '25', name: 'Oklahoma City Thunder', shortName: 'Thunder', abbreviation: 'OKC' },
        awayTeam: { id: '24', name: 'San Antonio Spurs', shortName: 'Spurs', abbreviation: 'SA' },
        teams: [
          { id: '25', name: 'Oklahoma City Thunder', shortName: 'Thunder', abbreviation: 'OKC' },
          { id: '24', name: 'San Antonio Spurs', shortName: 'Spurs', abbreviation: 'SA' },
        ],
        espnSeriesWins: { homeWins: 0, awayWins: 0 },
      },
    },
  });

  assert.equal(market.seriesMeta.key, 'basketball-nba:2026:series:24-25');
  assert.equal(market.seriesMeta.gameNumber, 1);
  assert.equal(market.seriesMeta.subtitle, 'Juego 1');
});
