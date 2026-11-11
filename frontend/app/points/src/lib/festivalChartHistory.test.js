import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFestivalPriceHistory } from './festivalChartHistory.js';

const point = (t, price) => ({ t, price });
const observations = history => history.map(({ t, price }) => point(t, price));

test('a completed minute preserves the observed moves on both sides of the opening', () => {
  const input = {
    from: 0, to: 180_000,
    bars: [point(30_000, 98)],
    ticks: [point(68_000, 100)],
    live: [point(105_000, 101), point(118_000, 99), point(121_000, 104), point(127_000, 102)],
    opening: point(120_000, 100),
  };
  const before = observations(buildFestivalPriceHistory(input));
  const after = observations(buildFestivalPriceHistory({
    ...input,
    bars: [...input.bars, point(120_000, 109)],
    ticks: [...input.ticks, point(125_000, 110)],
  }));
  assert.deepEqual(after, before);
  assert.deepEqual(after, [input.bars[0], input.ticks[0], ...input.live.slice(0, 2), input.opening, ...input.live.slice(2)]);
});

test('a fresh visit uses recorded ticks and bars to fill gaps with the official close last', () => {
  const history = buildFestivalPriceHistory({
    from: 60_000, to: 240_000,
    bars: [point(10_000, 96), point(90_000, 98), point(180_000, 101), point(240_000, 103)],
    ticks: [point(181_000, 101.4), point(245_000, 105)],
    live: [],
    opening: point(120_000, 100),
    closing: point(240_000, 102.5),
  });
  assert.deepEqual(observations(history), [point(90_000, 98), point(120_000, 100), point(181_000, 101.4), point(240_000, 102.5)]);
});
