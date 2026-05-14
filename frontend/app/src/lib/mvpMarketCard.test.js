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
