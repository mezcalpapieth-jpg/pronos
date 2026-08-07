import test from 'node:test';
import assert from 'node:assert/strict';

import {
  crypto5MinWindowsForTick,
  ensureUpcomingCryptoMarkets,
  formatDirectionFinalScore,
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
