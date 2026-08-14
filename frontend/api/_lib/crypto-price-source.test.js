import test from 'node:test';
import assert from 'node:assert/strict';

import { readCoinbaseBoundaryPrice } from './crypto-price-source.js';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test('readCoinbaseBoundaryPrice uses the candle close ending at the boundary', async () => {
  const seen = [];
  const result = await readCoinbaseBoundaryPrice({
    productId: 'btc-usd',
    timestamp: '2026-08-08T09:10:00.000Z',
    fetchImpl: async (url) => {
      seen.push(String(url));
      return jsonResponse([
        [1786180140, 64940, 64970, 64950, 64963.49, 3.1],
        [1786180080, 64930, 64960, 64945, 64951.25, 2.4],
      ]);
    },
  });

  assert.equal(result.price, 64963.49);
  assert.equal(result.source, 'coinbase-candle');
  assert.equal(result.productId, 'BTC-USD');
  assert.equal(result.candleStartAt, '2026-08-08T09:09:00.000Z');
  assert.equal(result.capturedAt, '2026-08-08T09:10:00.000Z');
  assert.match(seen[0], /products\/BTC-USD\/candles/);
  assert.match(seen[0], /granularity=60/);
});

test('readCoinbaseBoundaryPrice rejects missing boundary data instead of guessing far away', async () => {
  await assert.rejects(
    readCoinbaseBoundaryPrice({
      productId: 'ETH-USD',
      timestamp: '2026-08-08T09:10:00.000Z',
      fetchImpl: async () => jsonResponse([
        [1786179600, 1900, 1910, 1905, 1908.5, 1.2],
      ]),
    }),
    /no boundary candle available/,
  );
});

test('readCoinbaseBoundaryPrice surfaces upstream failures', async () => {
  await assert.rejects(
    readCoinbaseBoundaryPrice({
      productId: 'BTC-USD',
      timestamp: '2026-08-08T09:10:00.000Z',
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        json: async () => ({}),
      }),
    }),
    /coinbase candles failed 429/,
  );
});
