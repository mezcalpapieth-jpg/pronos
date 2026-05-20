import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('LiveScorePanel fetches cached ESPN scores and stays display-only', async () => {
  const source = await readFile(new URL('./LiveScorePanel.jsx', import.meta.url), 'utf8');

  assert.match(source, /\/api\/sports\/live-score/);
  assert.match(source, /points\.liveScore\.title/);
  assert.match(source, /setInterval\(load,\s*30_000\)/);
  assert.doesNotMatch(source, /\/api\/points\/buy|\/api\/protocol\/buy/);
});

test('points and MVP detail pages render the shared live score panel', async () => {
  const points = await readFile(new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');
  const mvp = await readFile(new URL('../pages/MarketDetail.jsx', import.meta.url), 'utf8');

  assert.match(points, /LiveScorePanel/);
  assert.match(mvp, /LiveScorePanel/);
});
