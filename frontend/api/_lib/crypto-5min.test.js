import test from 'node:test';
import assert from 'node:assert/strict';

import {
  catchUpCurrentPendingCryptoMarkets,
  catchUpExpiredActiveCryptoMarkets,
  catchUpMissedPendingCryptoMarkets,
  crypto5MinWindowsForTick,
  ensureUpcomingCryptoMarkets,
  formatDirectionFinalScore,
  normalizeCryptoMinuteMarketInterval,
  readCryptoMinuteMarketInterval,
  resolveDirectionOutcome,
} from './crypto-5min.js';

test('resolveDirectionOutcome maps a close above threshold to SUBE and below threshold to BAJA', () => {
  assert.equal(resolveDirectionOutcome(100_001, 100_000), 0);
  assert.equal(resolveDirectionOutcome(99_999, 100_000), 1);
});

test('resolveDirectionOutcome returns null for an exact tie', () => {
  assert.equal(resolveDirectionOutcome(100_000, 100_000), null);
});

test('formatDirectionFinalScore mirrors the existing crypto final-score label', () => {
  assert.equal(formatDirectionFinalScore(100000, 100123.456), '$100000 -> $100123.46');
});

test('crypto5MinWindowsForTick exposes the current and next five-minute boundaries', () => {
  const windows = crypto5MinWindowsForTick('2026-08-07T12:03:42.000Z');

  assert.equal(windows.boundary.toISOString(), '2026-08-07T12:00:00.000Z');
  assert.equal(windows.nextBoundary.toISOString(), '2026-08-07T12:05:00.000Z');
  assert.equal(windows.sinceBoundaryMs, 222_000);
  assert.equal(windows.msUntilNextBoundary, 78_000);
});

test('crypto5MinWindowsForTick supports admin-selected minute intervals', () => {
  const windows = crypto5MinWindowsForTick('2026-08-07T12:13:42.000Z', 15);

  assert.equal(windows.intervalMinutes, 15);
  assert.equal(windows.boundary.toISOString(), '2026-08-07T12:00:00.000Z');
  assert.equal(windows.nextBoundary.toISOString(), '2026-08-07T12:15:00.000Z');
  assert.equal(windows.sinceBoundaryMs, 822_000);
  assert.equal(windows.msUntilNextBoundary, 78_000);
});

test('normalizeCryptoMinuteMarketInterval accepts only supported admin intervals', () => {
  assert.equal(normalizeCryptoMinuteMarketInterval(10), 10);
  assert.equal(normalizeCryptoMinuteMarketInterval({ intervalMinutes: 30 }), 30);
  assert.equal(normalizeCryptoMinuteMarketInterval({ minutes: 60 }), 60);
  assert.equal(normalizeCryptoMinuteMarketInterval(7), 5);
  assert.equal(normalizeCryptoMinuteMarketInterval('bad'), 5);
});

test('readCryptoMinuteMarketInterval reads the stored admin setting', async () => {
  const sql = () => Promise.resolve([{ value: { minutes: 30 } }]);

  assert.equal(await readCryptoMinuteMarketInterval(sql), 30);
});

test('ensureUpcomingCryptoMarkets pre-creates the next pending BTC and ETH windows', async () => {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([{ id: calls.length }]);
  };

  const report = await ensureUpcomingCryptoMarkets(sql, {
    now: '2026-08-07T12:03:42.000Z',
    lookaheadWindows: 1,
  });

  assert.equal(report.precreated, 2);
  assert.equal(report.existing, 0);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    report.windows.map((window) => window.sourceEventId),
    ['btc:2026-08-07T12:05:00.000Z', 'eth:2026-08-07T12:05:00.000Z'],
  );
  assert.deepEqual(
    report.windows.map((window) => window.windowEnd),
    ['2026-08-07T12:10:00.000Z', '2026-08-07T12:10:00.000Z'],
  );
});

test('ensureUpcomingCryptoMarkets suffixes non-five-minute source ids', async () => {
  const sql = () => Promise.resolve([{ id: 1 }]);

  const report = await ensureUpcomingCryptoMarkets(sql, {
    now: '2026-08-07T12:03:42.000Z',
    intervalMinutes: 10,
    lookaheadWindows: 1,
  });

  assert.deepEqual(
    report.windows.map((window) => window.sourceEventId),
    ['btc:2026-08-07T12:10:00.000Z:10m', 'eth:2026-08-07T12:10:00.000Z:10m'],
  );
  assert.deepEqual(
    report.windows.map((window) => window.windowEnd),
    ['2026-08-07T12:20:00.000Z', '2026-08-07T12:20:00.000Z'],
  );
  assert.equal(report.windows.every((window) => window.intervalMinutes === 10), true);
});

test('ensureUpcomingCryptoMarkets dry run reports windows without writes', async () => {
  const sql = () => {
    throw new Error('dry run should not write');
  };

  const report = await ensureUpcomingCryptoMarkets(sql, {
    now: '2026-08-07T12:00:10.000Z',
    dry: true,
    lookaheadWindows: 2,
  });

  assert.equal(report.precreated, 0);
  assert.equal(report.existing, 0);
  assert.equal(report.windows.length, 4);
  assert.equal(report.windows[0].sourceEventId, 'btc:2026-08-07T12:05:00.000Z');
  assert.equal(report.windows[2].sourceEventId, 'btc:2026-08-07T12:10:00.000Z');
  assert.equal(report.windows.every((window) => window.dry), true);
});

test('catchUpCurrentPendingCryptoMarkets activates a current pending crypto window', async () => {
  const queries = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    queries.push({ text, values });
    if (/SELECT id, source_event_id/.test(text)) {
      return Promise.resolve(values.includes('btc:2026-08-07T12:05:00.000Z')
        ? [{
            id: 77,
            source_event_id: 'btc:2026-08-07T12:05:00.000Z',
            start_time: '2026-08-07T12:05:00.000Z',
            end_time: '2026-08-07T12:10:00.000Z',
            resolver_config: {
              shape: 'binary-direction',
              asset: 'btc',
              threshold: null,
              closesAt: '2026-08-07T12:10:00.000Z',
            },
          }]
        : []);
    }
    if (/UPDATE points_markets/.test(text)) {
      return Promise.resolve([{ id: 77 }]);
    }
    throw new Error(`unexpected query ${text}`);
  };

  const report = await catchUpCurrentPendingCryptoMarkets(sql, {
    now: '2026-08-07T12:07:20.000Z',
    intervalMinutes: 5,
    readBoundaryPrice: async ({ productId, timestamp }) => {
      assert.equal(productId, 'BTC-USD');
      assert.equal(new Date(timestamp).toISOString(), '2026-08-07T12:05:00.000Z');
      return {
        price: 100.6,
        source: 'coinbase-candle',
        capturedAt: '2026-08-07T12:05:10.000Z',
      };
    },
  });

  assert.equal(report.checked, 1);
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.activated.map(row => row.id), [77]);
  assert.equal(report.activated[0].threshold, 101);
  assert.equal(report.activated[0].windowStart, '2026-08-07T12:05:00.000Z');
  assert.equal(queries.filter(q => /UPDATE points_markets/.test(q.text)).length, 1);
});

test('catchUpExpiredActiveCryptoMarkets resolves active crypto windows after a missed boundary tick', async () => {
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    if (/SELECT id, source_event_id/.test(text)) {
      assert.equal(values[0], '2026-08-07T12:11:30.000Z');
      return Promise.resolve([
        {
          id: 88,
          source_event_id: 'eth:2026-08-07T12:05:00.000Z',
          end_time: '2026-08-07T12:10:00.000Z',
          resolver_config: {
            shape: 'binary-direction',
            asset: 'eth',
            threshold: 2000,
            closesAt: '2026-08-07T12:10:00.000Z',
          },
        },
      ]);
    }
    throw new Error(`unexpected query ${text}`);
  };
  const updates = [];
  const snapshots = [];

  const report = await catchUpExpiredActiveCryptoMarkets(sql, {
    now: '2026-08-07T12:11:30.000Z',
    limit: 4,
    readBoundaryPrice: async ({ productId, timestamp }) => {
      assert.equal(productId, 'ETH-USD');
      assert.equal(new Date(timestamp).toISOString(), '2026-08-07T12:10:00.000Z');
      return {
        price: 1999.4,
        source: 'coinbase-candle',
        capturedAt: '2026-08-07T12:10:03.000Z',
      };
    },
    transaction: async (handler) => handler({
      query: async (text, params = []) => {
        updates.push({ text, params });
        return { rows: [{ id: params[0] }] };
      },
    }),
    persistSnapshot: async (_client, marketId, label) => {
      snapshots.push({ marketId, label });
      return { stored: true };
    },
  });

  assert.equal(report.checked, 1);
  assert.equal(report.errors.length, 0);
  assert.equal(report.resolved.length, 1);
  assert.equal(report.resolved[0].id, 88);
  assert.equal(report.resolved[0].outcome, 1);
  assert.equal(report.resolved[0].finalScore, '$2000 -> $1999.40');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params[1], 1);
  assert.equal(updates[0].params[2], '$2000 -> $1999.40');
  assert.deepEqual(snapshots, [{ marketId: 88, label: 'crypto-5min-missed-active' }]);
});

test('catchUpMissedPendingCryptoMarkets resolves expired pending crypto windows', async () => {
  const queries = [];
  const sql = (strings, ...values) => {
    queries.push({ text: strings.join('?'), values });
    return Promise.resolve([
      {
        id: 42,
        source_event_id: 'btc:2026-08-07T12:30:00.000Z',
        start_time: '2026-08-07T12:30:00.000Z',
        end_time: '2026-08-07T12:35:00.000Z',
        resolver_config: {
          shape: 'binary-direction',
          asset: 'btc',
          threshold: null,
          closesAt: '2026-08-07T12:35:00.000Z',
        },
      },
    ]);
  };
  const updates = [];
  const snapshots = [];

  const report = await catchUpMissedPendingCryptoMarkets(sql, {
    now: '2026-08-07T12:40:00.000Z',
    limit: 4,
    readBoundaryPrice: async ({ productId, timestamp }) => {
      assert.equal(productId, 'BTC-USD');
      const iso = new Date(timestamp).toISOString();
      if (iso === '2026-08-07T12:30:00.000Z') {
        return {
          price: 100.2,
          source: 'coinbase-candle',
          capturedAt: iso,
        };
      }
      if (iso === '2026-08-07T12:35:00.000Z') {
        return {
          price: 101.4,
          source: 'coinbase-candle',
          capturedAt: iso,
        };
      }
      throw new Error(`unexpected timestamp ${iso}`);
    },
    transaction: async (handler) => handler({
      query: async (text, params = []) => {
        updates.push({ text, params });
        return { rows: [{ id: params[0] }] };
      },
    }),
    persistSnapshot: async (_client, marketId, label) => {
      snapshots.push({ marketId, label });
      return { stored: true };
    },
  });

  assert.equal(report.checked, 1);
  assert.equal(report.errors.length, 0);
  assert.equal(report.resolved.length, 1);
  assert.equal(report.resolved[0].id, 42);
  assert.equal(report.resolved[0].threshold, 100);
  assert.equal(report.resolved[0].outcome, 0);
  assert.equal(report.resolved[0].finalScore, '$100 -> $101.40');
  assert.equal(queries.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].params[1], 0);
  assert.equal(updates[0].params[2], '$100 -> $101.40');
  assert.deepEqual(snapshots, [{ marketId: 42, label: 'crypto-5min-missed-pending' }]);
});
