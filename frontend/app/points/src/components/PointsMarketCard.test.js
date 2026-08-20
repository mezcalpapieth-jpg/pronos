import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsMarketCard.jsx', import.meta.url), 'utf8');

test('points market card routes AICM delay children back into the hub', () => {
  assert.match(source, /AICM_HUB_PATH, isAicmDelayMarket/);
  assert.match(source, /const isAicmDelayCard = isAicmDelayMarket\(market\)/);
  assert.match(source, /isAicmDelayCard[\s\S]*\? AICM_HUB_PATH/);
});
