import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  computeChartWindow,
  densifyPoints,
  nearestPointByX,
} from './cryptoChartMath.js';

test('computeChartWindow honors explicit lifecycle anchors', () => {
  const window = computeChartWindow({
    history: [{ t: 10_000, price: 100 }],
    xStart: 1_000,
    xEnd: 301_000,
    windowMs: 60_000,
  });

  assert.deepEqual(window, { xMin: 1_000, xMax: 301_000 });
});

test('computeChartWindow falls back to a sliding window around the latest tick', () => {
  const window = computeChartWindow({
    history: [
      { t: 1_000, price: 100 },
      { t: 10_000, price: 101 },
    ],
    windowMs: 5_000,
  });

  assert.deepEqual(window, { xMin: 5_000, xMax: 10_000 });
});

test('densifyPoints fills large gaps with one-second interpolated ticks', () => {
  const dense = densifyPoints(
    [
      { t: 0, price: 100 },
      { t: 5_000, price: 105 },
    ],
    { intervalMs: 1_000 }
  );

  assert.deepEqual(dense, [
    { t: 0, price: 100, interpolated: false },
    { t: 1_000, price: 101, interpolated: true },
    { t: 2_000, price: 102, interpolated: true },
    { t: 3_000, price: 103, interpolated: true },
    { t: 4_000, price: 104, interpolated: true },
    { t: 5_000, price: 105, interpolated: false },
  ]);
});

test('nearestPointByX returns the point closest to a projected chart coordinate', () => {
  const nearest = nearestPointByX(
    [
      { t: 0, price: 100 },
      { t: 1_000, price: 101 },
      { t: 2_000, price: 102 },
    ],
    118,
    {
      xMin: 0,
      xMax: 2_000,
      width: 220,
      padding: { left: 20, right: 20 },
    }
  );

  assert.equal(nearest.point.t, 1_000);
  assert.equal(nearest.x, 110);
});
