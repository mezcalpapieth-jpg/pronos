/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.orderbook.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('points market detail renders hybrid limit-order book depth', () => {
  assert.match(detailSource, /fetchOrderBook/);
  assert.match(detailSource, /fetchMyLimitOrders/);
  assert.match(detailSource, /placeLimitOrder/);
  assert.match(detailSource, /cancelLimitOrder/);
  assert.match(detailSource, /function OrderBookPanel/);
  assert.match(detailSource, /points\.detail\.orderBook/);
  assert.match(detailSource, /points\.detail\.orderBookSellSide/);
  assert.match(detailSource, /points\.detail\.orderBookBuySide/);
  assert.match(detailSource, /points\.detail\.orderBookSourceMaker/);
  assert.match(detailSource, /points\.detail\.limitOrderTitle/);
  assert.match(detailSource, /points\.detail\.limitOrderMakerReward/);
  assert.match(detailSource, /points\.detail\.limitOrderRewardEarned/);
  assert.match(detailSource, /points\.detail\.limitOrderOpenOrders/);
  assert.match(detailSource, /makerRewardAccrued/);
  assert.match(detailSource, /makerRewardEstimated/);
  assert.match(detailSource, /handlePickRow/);
  assert.match(detailSource, /bookCacheRef/);
  assert.match(detailSource, /requestIdleCallback/);
});

test('points market detail places orderbook in the left flow before outcome controls', () => {
  const orderBookIndex = detailSource.indexOf('<OrderBookPanel');
  const seriesStripIndex = detailSource.indexOf('<SeriesGameStrip');
  const asideIndex = detailSource.indexOf('<aside style');
  const gaugeIndex = detailSource.indexOf('<ProbabilityGaugeRow');
  assert.ok(orderBookIndex > 0, 'expected OrderBookPanel render call');
  assert.ok(orderBookIndex < seriesStripIndex, 'orderbook should sit right after the chart, before series navigation');
  assert.ok(orderBookIndex < gaugeIndex, 'orderbook should sit before the outcome question controls');
  assert.ok(orderBookIndex < asideIndex, 'orderbook should no longer live in the right rail');
});

test('points API client exposes orderbook and limit-order endpoints', () => {
  assert.match(apiSource, /export async function fetchOrderBook/);
  assert.match(apiSource, /export async function fetchMyLimitOrders/);
  assert.match(apiSource, /export async function placeLimitOrder/);
  assert.match(apiSource, /export async function cancelLimitOrder/);
  assert.match(apiSource, /\/api\/points\/orderbook\?/);
  assert.match(apiSource, /\/api\/points\/limit-orders\?/);
  assert.match(apiSource, /\/api\/points\/cancel-limit-order/);
  assert.match(apiSource, /outcomeIndex/);
  assert.match(apiSource, /levels/);
});

test('points market detail hides sold-out dust positions', () => {
  assert.match(detailSource, /DISPLAYABLE_SHARE_EPSILON\s*=\s*0\.005/);
  assert.match(detailSource, /Number\(p\.shares\) < DISPLAYABLE_SHARE_EPSILON/);
});
