import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mapProtocolMarketToCard,
  previewGain,
  priceForOutcome,
} from './mvpMarketCard.js';

test('mapProtocolMarketToCard preserves on-chain fields and exposes Points-style card data', () => {
  const card = mapProtocolMarketToCard({
    id: 42,
    marketId: '0x2a',
    poolAddress: '0xpool',
    chainId: 421614,
    question: 'Will BTC close above 100k?',
    category: 'crypto',
    outcomes: ['Sí', 'No'],
    prices: [0.64, 0.36],
    liquidity: 1234.56,
    volume24h: 89,
    status: 'active',
    live: true,
    endTime: '2026-06-01T00:00:00.000Z',
  });

  assert.equal(card.id, 42);
  assert.equal(card.mode, 'onchain');
  assert.equal(card.question, 'Will BTC close above 100k?');
  assert.deepEqual(card.outcomes, ['Sí', 'No']);
  assert.deepEqual(card.prices, [0.64, 0.36]);
  assert.equal(card.categoryLabel, 'Crypto');
  assert.equal(card.icon, '₿');
  assert.equal(card.live, true);
  assert.equal(card.volume, 1234.56);
  assert.equal(card.tradeVolume, 89);
});

test('priceForOutcome collapses resolved markets to winner 100 and loser 0', () => {
  const market = {
    status: 'resolved',
    outcome: 1,
    prices: [0.62, 0.38],
  };

  assert.equal(priceForOutcome(market, 0), 0);
  assert.equal(priceForOutcome(market, 1), 1);
});

test('previewGain estimates net gain for a 100 MXNB reference stake', () => {
  assert.equal(previewGain(0.5), 100);
  assert.equal(previewGain(0.25), 300);
  assert.equal(previewGain(0.99), 1);
});

test('mapProtocolMarketToCard exposes MVP taxonomy and regional outcome labels', () => {
  const worldCup = mapProtocolMarketToCard({
    id: 99,
    question: '¿México gana la Copa del Mundo 2026?',
    category: 'world-cup',
    outcomes: ['Sí', 'No'],
    prices: [0.4, 0.6],
    categoryTags: ['world-cup'],
    geoTags: [],
    topicTags: ['world-cup'],
  });

  assert.equal(worldCup.categoryLabel, 'Copa del Mundo');
  assert.equal(worldCup.icon, '🏆');
  assert.deepEqual(worldCup.categoryTags, ['world-cup']);
  assert.deepEqual(worldCup.geoTags, []);

  const fight = mapProtocolMarketToCard({
    id: 100,
    question: '¿Quién gana Marlon Vera vs Sean OMalley?',
    category: 'deportes',
    outcomes: ['Marlon Vera', 'Sean OMalley'],
    prices: [0.52, 0.48],
    sport: 'combate',
    league: 'ufc',
    outcomeCountryLabels: ['Ecuador', null],
  });

  assert.deepEqual(fight.outcomeCountryLabels, ['Ecuador', null]);
  assert.equal(fight.sport, 'combate');
  assert.equal(fight.league, 'ufc');
});
