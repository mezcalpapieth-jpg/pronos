import test from 'node:test';
import assert from 'node:assert/strict';

import {
  displayTradePointsFromRows,
  mergeDisplayPricePoints,
  priceHistoryExecutionBucket,
} from './points-price-history-display.js';

test('price history collapses a mixed execution burst to the public final price', () => {
  const rows = [
    {
      id: 10,
      market_id: 7,
      username: 'buyer',
      side: 'buy',
      outcome_index: 1,
      price_at_trade: 0.60,
      reserves_before: [50, 50],
      reserves_after: [50, 50],
      created_at: '2026-08-19T16:24:10.000Z',
    },
    {
      id: 11,
      market_id: 7,
      username: 'buyer',
      side: 'buy',
      outcome_index: 1,
      price_at_trade: 0.54,
      reserves_before: [50, 50],
      reserves_after: [54, 46],
      created_at: '2026-08-19T16:24:10.800Z',
    },
  ];

  const padresPoints = displayTradePointsFromRows(rows, 1);
  const metsPoints = displayTradePointsFromRows(rows, 0);
  assert.equal(padresPoints.length, 1);
  assert.equal(metsPoints.length, 1);
  assert.equal(padresPoints[0].p, 54);
  assert.equal(metsPoints[0].p, 46);

  const snapshotBucket = priceHistoryExecutionBucket('2026-08-19T16:24:11.000Z');
  const merged = mergeDisplayPricePoints([
    { t: Date.parse('2026-08-19T16:23:00.000Z') / 1000, p: 50, _source: 'snapshot', _bucket: 1 },
    { t: Date.parse('2026-08-19T16:24:11.000Z') / 1000, p: 60, _source: 'snapshot', _bucket: snapshotBucket },
  ], padresPoints);

  assert.deepEqual(merged.map(pt => pt.p), [50, 54]);
});

test('price history uses the fill price when a book-only execution does not move reserves', () => {
  const points = displayTradePointsFromRows([
    {
      id: 20,
      market_id: 8,
      username: 'buyer',
      side: 'buy',
      outcome_index: 1,
      price_at_trade: 0.54,
      reserves_before: [50, 50],
      reserves_after: [50, 50],
      created_at: '2026-08-19T17:00:00.000Z',
    },
  ], 1);

  assert.equal(points.length, 1);
  assert.equal(points[0].p, 54);
});
