/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.orderbook.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('points market detail renders AMM-backed order book depth', () => {
  assert.match(detailSource, /fetchOrderBook/);
  assert.match(detailSource, /function OrderBookPanel/);
  assert.match(detailSource, /points\.detail\.orderBook/);
  assert.match(detailSource, /points\.detail\.orderBookSellSide/);
  assert.match(detailSource, /points\.detail\.orderBookBuySide/);
});

test('points API client exposes orderbook endpoint', () => {
  assert.match(apiSource, /export async function fetchOrderBook/);
  assert.match(apiSource, /\/api\/points\/orderbook\?/);
  assert.match(apiSource, /outcomeIndex/);
  assert.match(apiSource, /levels/);
});
