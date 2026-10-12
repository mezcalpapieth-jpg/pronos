import test from 'node:test';
import assert from 'node:assert/strict';
import { candleTimeLabel, nearestStockCandle } from './stockChart.js';

test('chart cursor selects the nearest real candle across gaps and clamps at the edges', () => {
  const candles = [{ t: 1000 }, { t: 2000 }, { t: 7000 }, { t: 9000 }];
  for (const [time, index] of [[0, 0], [1000, 0], [1500, 0], [1999, 1], [4600, 2], [9000, 3], [20000, 3]]) {
    assert.equal(nearestStockCandle(candles, time), index);
  }
  assert.equal(nearestStockCandle([], 1000), -1);
  assert.equal(nearestStockCandle(candles, NaN), -1);
  assert.equal(nearestStockCandle([{ t: 123 }], 1000), 0);
});

test('tooltip time uses the provider candle timestamp in UTC regardless of machine timezone', () => {
  const stamp = Date.UTC(2026, 9, 12, 23, 45);
  const prior = process.env.TZ;
  try {
    process.env.TZ = 'America/Mexico_City';
    assert.match(candleTimeLabel(stamp), /12.*2026.*23:45.*UTC/);
    process.env.TZ = 'Europe/Rome';
    assert.match(candleTimeLabel(stamp, 'en'), /12.*2026.*23:45.*UTC/);
  } finally {
    if (prior == null) delete process.env.TZ;
    else process.env.TZ = prior;
  }
});
