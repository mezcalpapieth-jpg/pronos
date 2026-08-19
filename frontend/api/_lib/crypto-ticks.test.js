import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CRYPTO_TICK_RETENTION_HOURS,
  cryptoTickBucketIso,
  insertCryptoTick,
  maybePruneCryptoTicks,
  shouldPruneCryptoTicks,
} from './crypto-ticks.js';

test('cryptoTickBucketIso floors timestamps into stable five-second buckets', () => {
  assert.equal(
    cryptoTickBucketIso('2026-08-19T12:00:17.999Z'),
    '2026-08-19T12:00:15.000Z',
  );
});

test('insertCryptoTick stores normalized asset and bucketed timestamp', async () => {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([{ id: 123 }]);
  };

  const result = await insertCryptoTick(sql, {
    asset: 'BTC',
    price: 64250.75,
    capturedAt: '2026-08-19T12:00:17.999Z',
  });

  assert.deepEqual(result, {
    stored: true,
    bucket: '2026-08-19T12:00:15.000Z',
  });
  assert.match(calls[0].text, /INSERT INTO crypto_ticks/);
  assert.match(calls[0].text, /ON CONFLICT \(asset, captured_at\) DO NOTHING/);
  assert.equal(calls[0].values[0], 'btc');
  assert.equal(calls[0].values[1], '2026-08-19T12:00:15.000Z');
  assert.equal(calls[0].values[2], 64250.75);
});

test('shouldPruneCryptoTicks only opens the cleanup window for stored hourly ticks', () => {
  assert.equal(shouldPruneCryptoTicks({
    stored: true,
    bucketIso: '2026-08-19T12:00:35.000Z',
  }), true);
  assert.equal(shouldPruneCryptoTicks({
    stored: true,
    bucketIso: '2026-08-19T12:01:00.000Z',
  }), false);
  assert.equal(shouldPruneCryptoTicks({
    stored: false,
    bucketIso: '2026-08-19T12:00:00.000Z',
  }), false);
});

test('maybePruneCryptoTicks deletes old rows for the same asset with 72h retention', async () => {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([{ deleted: 7 }]);
  };

  const result = await maybePruneCryptoTicks(sql, {
    asset: 'eth',
    stored: true,
    bucketIso: '2026-08-19T12:00:05.000Z',
  });

  assert.deepEqual(result, { pruned: true, deleted: 7 });
  assert.match(calls[0].text, /DELETE FROM crypto_ticks/);
  assert.match(calls[0].text, /WHERE asset = \?/);
  assert.equal(calls[0].values[0], 'eth');
  assert.equal(calls[0].values[1], CRYPTO_TICK_RETENTION_HOURS);
});
