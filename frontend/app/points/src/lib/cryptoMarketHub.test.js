import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCryptoMarketSequence,
  computeCryptoGraphFrame,
  cryptoMarketSequenceSignature,
  getSelectedCryptoMarket,
} from './cryptoMarketHub.js';

const baseMarket = {
  id: 42,
  question: 'Bitcoin: ¿sube o baja a las 12:05 CDMX?',
  outcomes: ['SUBE', 'BAJA'],
  prices: [0.52, 0.48],
  status: 'active',
  outcome: null,
  finalScore: null,
  startTime: '2026-05-14T17:00:00.000Z',
  endTime: '2026-05-14T17:05:00.000Z',
  cryptoMeta: {
    asset: 'btc',
    symbol: 'BTC/USD',
    coinbaseProductId: 'BTC-USD',
    threshold: 100000,
    openPrice: 100000,
    openedAt: '2026-05-14T17:00:00.000Z',
    closesAt: '2026-05-14T17:05:00.000Z',
    marketSequence: [
      {
        id: 43,
        question: 'Bitcoin: ¿sube o baja a las 12:10 CDMX?',
        outcomes: ['SUBE', 'BAJA'],
        prices: [0.5, 0.5],
        status: 'pending',
        startTime: '2026-05-14T17:05:00.000Z',
        endTime: '2026-05-14T17:10:00.000Z',
        cryptoMeta: {
          asset: 'btc',
          symbol: 'BTC/USD',
          coinbaseProductId: 'BTC-USD',
          threshold: null,
          openPrice: null,
          openedAt: null,
          closesAt: '2026-05-14T17:10:00.000Z',
        },
      },
      {
        id: 41,
        question: 'Bitcoin: ¿sube o baja a las 12:00 CDMX?',
        outcomes: ['SUBE', 'BAJA'],
        prices: [1, 0],
        status: 'resolved',
        outcome: 0,
        finalScore: '$99900 -> $100000.00',
        startTime: '2026-05-14T16:55:00.000Z',
        endTime: '2026-05-14T17:00:00.000Z',
        cryptoMeta: {
          asset: 'btc',
          symbol: 'BTC/USD',
          coinbaseProductId: 'BTC-USD',
          threshold: 99900,
          openPrice: 99900,
          closePrice: 100000,
          openedAt: '2026-05-14T16:55:00.000Z',
          closesAt: '2026-05-14T17:00:00.000Z',
        },
      },
    ],
  },
};

test('buildCryptoMarketSequence inserts the current market and sorts windows by start time', () => {
  const sequence = buildCryptoMarketSequence(baseMarket);

  assert.deepEqual(sequence.map((market) => market.id), [41, 42, 43]);
  assert.equal(sequence[1].cryptoMeta.threshold, 100000);
});

test('getSelectedCryptoMarket switches only the selected market overlay fields', () => {
  const selected = getSelectedCryptoMarket(baseMarket, 43);

  assert.equal(selected.id, 43);
  assert.equal(selected.status, 'pending');
  assert.equal(selected.cryptoMeta.threshold, null);
  assert.equal(selected.cryptoMeta.asset, 'btc');
  assert.deepEqual(selected.outcomes, ['SUBE', 'BAJA']);
});

test('computeCryptoGraphFrame is asset-level and does not depend on selected market id', () => {
  const sequence = buildCryptoMarketSequence(baseMarket);
  const nowMs = Date.parse('2026-05-14T17:02:00.000Z');
  const history = [
    { t: Date.parse('2026-05-14T16:59:00.000Z'), price: 99960 },
    { t: Date.parse('2026-05-14T17:02:00.000Z'), price: 100020 },
  ];

  const activeSelection = computeCryptoGraphFrame(sequence, { nowMs, history });
  const pendingSelection = computeCryptoGraphFrame(sequence, { nowMs, history });

  assert.deepEqual(activeSelection, pendingSelection);
  assert.deepEqual(activeSelection, {
    xStart: Date.parse('2026-05-14T16:55:00.000Z'),
    xEnd: Date.parse('2026-05-14T17:05:00.000Z'),
  });
});

test('cryptoMarketSequenceSignature changes when lifecycle metadata changes', () => {
  const sequence = buildCryptoMarketSequence(baseMarket);
  const promoted = sequence.map((market) => (
    market.id === 43
      ? { ...market, status: 'active', cryptoMeta: { ...market.cryptoMeta, threshold: 100030 } }
      : market
  ));

  assert.notEqual(
    cryptoMarketSequenceSignature(sequence),
    cryptoMarketSequenceSignature(promoted),
  );
});

test('cryptoMarketSequenceSignature changes when prices move after a trade', () => {
  const sequence = buildCryptoMarketSequence(baseMarket);
  const traded = sequence.map((market) => (
    market.id === 42
      ? { ...market, prices: [0.57, 0.43] }
      : market
  ));

  assert.notEqual(
    cryptoMarketSequenceSignature(sequence),
    cryptoMarketSequenceSignature(traded),
  );
});
