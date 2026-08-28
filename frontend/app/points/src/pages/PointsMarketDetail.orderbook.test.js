/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.orderbook.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const combinadaSlipSource = await readFile(new URL('../lib/combinadaSlip.js', import.meta.url), 'utf8');
const combinadaPanelSource = await readFile(new URL('../components/CombinadaSlipPanel.jsx', import.meta.url), 'utf8');
const combinadaDrawerSource = await readFile(new URL('../components/CombinadaMarketPickerDrawer.jsx', import.meta.url), 'utf8');

test('points market detail renders hybrid limit-order book depth', () => {
  assert.match(detailSource, /MarketHeroImage/);
  assert.match(detailSource, /marketImageSrc/);
  assert.match(detailSource, /marketPlaceholderImageSrc/);
  assert.match(detailSource, /fetchOrderBook/);
  assert.match(detailSource, /fetchMyLimitOrders/);
  assert.match(detailSource, /placeLimitOrder/);
  assert.match(detailSource, /cancelLimitOrder/);
  assert.match(detailSource, /function OrderBookPanel/);
  assert.match(detailSource, /points\.detail\.orderBook/);
  assert.match(detailSource, /points\.detail\.orderBookSellSide/);
  assert.match(detailSource, /points\.detail\.orderBookBuySide/);
  assert.match(detailSource, /showSource = false/);
  assert.match(detailSource, /points\.detail\.limitOrderTitle/);
  assert.match(detailSource, /points\.detail\.limitOrderMakerReward/);
  assert.match(detailSource, /points\.detail\.limitOrderRewardEarned/);
  assert.match(detailSource, /points\.detail\.limitOrderOpenOrders/);
  assert.match(detailSource, /makerRewardAccrued/);
  assert.match(detailSource, /makerRewardEstimated/);
  assert.match(detailSource, /handlePickRow/);
  assert.match(detailSource, /bookCacheRef/);
  assert.match(detailSource, /requestIdleCallback/);
  assert.match(detailSource, /\/que-es-el-libro-de-ordenes/);
  assert.match(detailSource, /Cómo funciona/);
});

test('points market detail places mobile trade controls before orderbook', () => {
  const tradePanelIndex = detailSource.indexOf('const tradePanel = (');
  const mobileTradeIndex = detailSource.indexOf('{isMobile && tradePanel}');
  const activityTapeIndex = detailSource.indexOf('<PointsActivityTape');
  const orderBookIndex = detailSource.indexOf('<OrderBookPanel');
  const seriesStripIndex = detailSource.indexOf('<SeriesGameStrip');
  const asideIndex = detailSource.indexOf('<aside style');
  const desktopTradeIndex = detailSource.indexOf('{!isMobile && tradePanel}');
  assert.ok(tradePanelIndex > 0, 'expected shared trade panel render block');
  assert.ok(mobileTradeIndex > tradePanelIndex, 'expected mobile trade panel placement');
  assert.ok(orderBookIndex > 0, 'expected OrderBookPanel render call');
  assert.ok(mobileTradeIndex < orderBookIndex, 'mobile trade controls should sit between the chart and orderbook');
  assert.ok(activityTapeIndex > mobileTradeIndex, 'activity tape should sit after mobile trade controls');
  assert.ok(activityTapeIndex < orderBookIndex, 'activity tape should sit before the orderbook');
  assert.ok(orderBookIndex < seriesStripIndex, 'orderbook should stay after mobile trade controls and before series navigation');
  assert.ok(orderBookIndex < asideIndex, 'orderbook should remain in the left/mobile flow');
  assert.ok(desktopTradeIndex > asideIndex, 'desktop trade controls should stay in the right rail');
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

test('points market detail supports local parlay slip actions', () => {
  assert.match(combinadaSlipSource, /PARLAY_SLIP_STORAGE_KEY/);
  assert.match(combinadaSlipSource, /addParlayLeg/);
  assert.match(combinadaSlipSource, /parlayPayloadLegs/);
  assert.match(combinadaPanelSource, /export default function CombinadaSlipPanel/);
  assert.match(combinadaDrawerSource, /export default function CombinadaMarketPickerDrawer/);
  assert.match(combinadaDrawerSource, /DrawerMarketThumbnail/);
  assert.match(combinadaDrawerSource, /marketImageSrc/);
  assert.match(combinadaDrawerSource, /featured: 'all'/);
  assert.doesNotMatch(combinadaDrawerSource, /market => market\?\.tournamentFeatured === true/);
  assert.match(detailSource, /tradeMode/);
  assert.match(detailSource, /CombinadaSlipPanel/);
  assert.match(detailSource, /CombinadaMarketPickerDrawer/);
  assert.match(detailSource, /handleAddParlayLeg/);
  assert.match(detailSource, /quoteParlay/);
  assert.match(detailSource, /createParlay/);
  assert.match(detailSource, /selectionMode=\{tradeMode\}/);
  assert.doesNotMatch(detailSource, /\+ Combo/);
  assert.match(detailSource, /Combinada/);
});

test('points API client exposes parlay endpoints', () => {
  assert.match(apiSource, /export async function quoteParlay/);
  assert.match(apiSource, /export async function createParlay/);
  assert.match(apiSource, /export async function fetchMyParlays/);
  assert.match(apiSource, /\/api\/points\/parlays\/quote/);
  assert.match(apiSource, /\/api\/points\/parlays/);
});

test('points market detail hides sold-out dust positions', () => {
  assert.match(detailSource, /DISPLAYABLE_SHARE_EPSILON\s*=\s*0\.005/);
  assert.match(detailSource, /Number\(p\.shares\) < DISPLAYABLE_SHARE_EPSILON/);
});
