import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const carousel = await readFile(
  new URL('./PointsActivityCarousel.jsx', import.meta.url),
  'utf8',
);
const home = await readFile(
  new URL('../pages/PointsHome.jsx', import.meta.url),
  'utf8',
);
const sparkline = await readFile(
  new URL('../../../src/components/Sparkline.jsx', import.meta.url),
  'utf8',
);
const multiSparkline = await readFile(
  new URL('../../../src/components/MultiSparkline.jsx', import.meta.url),
  'utf8',
);
const activityTape = await readFile(
  new URL('./PointsActivityTape.jsx', import.meta.url),
  'utf8',
);

test('carousel reads anonymous chart activity and the public named trade tape', () => {
  assert.match(carousel, /fetchTradeActivity/);
  assert.match(carousel, /fetchTradeTape/);
  assert.match(carousel, /<PointsActivityTape/);
  assert.doesNotMatch(carousel, /fetchRecentTrades|recent-trades/);
});

test('admission is recent real trading, never seed liquidity', () => {
  // `volume` is seed liquidity — non-zero on every market ever created,
  // traded or not. Only `tradeVolume` reflects money that changed hands.
  assert.match(carousel, /_vol: Number\(m\.tradeVolume \|\| 0\)/);
  assert.doesNotMatch(carousel, /m\.tradeVolume \?\? m\.volume/);
  // Seed liquidity never enters the shortlist, and recent slots score by
  // bucketed traded activity/volume.
  assert.match(carousel, /rankedByWindowMetric/);
  assert.match(carousel, /const WINDOW_HOURS = 24 \* 7/);
  assert.match(carousel, /const WINDOW_BUCKETS = 120/);
});

test('carousel uses hidden activity and volume slots before the bitcoin 5 minute slot', () => {
  assert.match(carousel, /key: '1h-interactions', hours: 1, metric: 'count'/);
  assert.match(carousel, /key: '1h-volume', hours: 1, metric: 'volume'/);
  assert.match(carousel, /key: '4h-activity', hours: 4, metric: 'count'/);
  assert.match(carousel, /key: '4h-volume', hours: 4, metric: 'volume'/);
  assert.match(carousel, /key: 'total-volume', hours: null, metric: 'totalVolume'/);
  assert.match(carousel, /key: '7d-activity', hours: WINDOW_HOURS, metric: 'count'/);
  assert.match(carousel, /key: '7d-volume', hours: WINDOW_HOURS, metric: 'volume'/);
  assert.match(carousel, /_slotKey: 'btc5m'/);
  assert.doesNotMatch(carousel, /_slotLabelKey/);
  assert.doesNotMatch(carousel, /points\.activity\.slot1h/);
});

test('hidden one-hour signals still display the full recent flow history', () => {
  assert.match(carousel, /const historyBuckets = bucketsForWindow\(recent\[entry\.market\.id\] \|\| \[\], WINDOW_HOURS, nowSeconds\)/);
  assert.match(carousel, /const historyTotals = bucketTotals\(historyBuckets\)/);
  assert.match(carousel, /_buckets: \[...historyBuckets\]\.sort/);
  assert.match(carousel, /_count: historyTotals\.count/);
  assert.match(carousel, /_displayVolume: historyTotals\.volume/);
  assert.match(carousel, /_buyWindow: historyTotals\.buy/);
  assert.match(carousel, /_sellWindow: historyTotals\.sell/);
});

test('music category displays as entertainment in the carousel', () => {
  assert.match(carousel, /function displayCategory\(category\)/);
  assert.match(carousel, /key === 'musica'\) return 'Entretenimiento'/);
  assert.match(carousel, /displayCategory\(m\.category\)/);
});

test('flow counts both sides of a binary market', () => {
  // A buy on NO still moves the YES price, so outcome=0 would hide half
  // the flow the panel claims to summarize.
  assert.match(carousel, /outcome: 'all'/);
});

test('parallel parent activity rolls up from leg ids', () => {
  // Multi-option parallel markets display as one parent card, but fills are
  // written to the individual leg rows. The carousel must ask for both and
  // merge activity back onto the parent before ranking.
  assert.match(carousel, /function activityRequestForMarkets\(markets/);
  assert.match(carousel, /m\.ammMode === 'parallel' && Array\.isArray\(m\.legIds\)/);
  assert.match(carousel, /ownerById\.set\(key, parentId\)/);
  assert.match(carousel, /fetchTradeActivity\(activityIds/);
  assert.match(carousel, /rollupActivityByParent\(a \|\| \{\}, activityRequest\)/);
});

test('parallel carousel charts draw leg histories without adopting a child identity', () => {
  // Multi-option parents should not inherit Zverev/Felix/etc. as the carousel
  // headline just because one child leg happens to be first in the id list.
  // The chart should still be a probability graph, not the right-side flow tape.
  assert.match(carousel, /import MultiSparkline from '@app\/components\/MultiSparkline\.jsx'/);
  assert.match(carousel, /function priceHistoryRequestForMarkets\(markets\)/);
  assert.match(carousel, /if \(m\.ammMode === 'parallel'\) \{/);
  assert.match(carousel, /sourceId: m\.legIds\[entry\.index\]/);
  assert.match(carousel, /sourceOutcome: 0/);
  assert.match(carousel, /function chartEntriesForMarket/);
  assert.match(carousel, /function leadingOutcomeForMarket/);
  assert.match(carousel, /<MultiSparkline/);
  assert.match(carousel, /series=\{mChartEntries\.map\(entry =>/);
  assert.match(carousel, /data: chartSeriesForOutcome\(m, entry, mOutcomeSeries\?\.\[entry\.index\]\)/);
  assert.match(carousel, /activity=\{\[m\._buckets \|\| \[\]\]\}/);
  assert.match(carousel, /points\.activity\.tied/);
  assert.match(carousel, /isMultiChart \? mLeader\.label : mOutcomes\[0\]/);
  assert.match(carousel, /const mLeadPct = isMultiChart \? mLeader\.pct/);
  assert.doesNotMatch(carousel, /m\.legIds\[0\]/);
  assert.doesNotMatch(carousel, /targetPct=\{isParallel \? 100 : mLeadPct\}/);
  assert.doesNotMatch(carousel, /aggregateParallelFlowSeries/);
  assert.doesNotMatch(carousel, /function FlowSparkline/);
  assert.match(carousel, /fetchPriceHistory\(group\.ids/);
  assert.match(carousel, /remapHistoryByParent\(priceResults, priceHistoryRequest\)/);
});

test('carousel charts use a 24h time window with the shared hard-step line', () => {
  assert.match(carousel, /const CHART_HISTORY_HOURS = 24/);
  assert.match(carousel, /fetchPriceHistory\(group\.ids, \{ hours: CHART_HISTORY_HOURS/);
  assert.match(carousel, /function chartSeriesForOutcome/);
  // The opening baseline anchors at the axis' left edge — the market's
  // creation when it was born inside the window, the window start when it
  // was born earlier — so the line never begins mid-chart.
  assert.match(carousel, /const anchorT = Math\.max\(openedAt, windowStart\)/);
  assert.match(carousel, /points\.unshift\(\{ t: anchorT, p: openingPct \}\)/);
  assert.match(carousel, /points\.push\(\{ t: now, p: targetPct \}\)/);
  assert.match(carousel, /pp · 24h/);
  // Carousel charts no longer override jumpShape — they fall back to the
  // shared components' default hard step, matching the market detail page.
  assert.doesNotMatch(carousel, /jumpShape="soft-step"/);
  assert.doesNotMatch(carousel, /<MultiSparkline[\s\S]{0,260}domainMin=\{0\}[\s\S]{0,80}domainMax=\{100\}/);
  assert.match(sparkline, /xMode = 'time'/);
  assert.match(sparkline, /fitDomain = false/);
  assert.match(sparkline, /jumpShape = 'step'/);
  assert.match(sparkline, /jumpShape === 'soft-step'/);
  assert.match(sparkline, /const useMovementAxis = xMode === 'movement'/);
  assert.match(multiSparkline, /xMode = 'time'/);
  assert.match(multiSparkline, /jumpShape = 'step'/);
  assert.match(multiSparkline, /jumpShape === 'soft-step'/);
  assert.match(multiSparkline, /const useMovementAxis = xMode === 'movement'/);
});

test('bitcoin crypto carousel slide backfills from crypto tick history', () => {
  assert.match(carousel, /import \{ fetchCryptoHistory, fetchPriceHistory, fetchTradeActivity, fetchTradeTape \}/);
  assert.match(carousel, /const CRYPTO_PRICE_PERCENT_TO_PP = 25/);
  assert.match(carousel, /function cryptoSeriesForMarket/);
  assert.match(carousel, /function mergeCryptoHistoryByParent/);
  assert.match(carousel, /const shifted = Number\.isFinite\(targetPct\) && Number\.isFinite\(lastPct\)/);
  assert.match(carousel, /const cryptoHistoryMarkets = useMemo/);
  assert.match(carousel, /fetchCryptoHistory\(m\.id\)/);
  assert.match(carousel, /setHistory\(mergeCryptoHistoryByParent\(priceHistory, cryptoResults\)\)/);
});

test('visible parallel slide polling keeps querying leg activity', () => {
  assert.match(carousel, /const request = activityRequestForMarkets\(\[active\]\)/);
  assert.match(carousel, /fetchTradeActivity\(request\.ids/);
  assert.match(carousel, /rollupActivityByParent\(a \|\| \{\}, request\)/);
  assert.match(carousel, /const buckets = rolled\?\.\[active\.id\]/);
});

test('public activity tape renders named buys and sells without execution-source labels', () => {
  assert.match(activityTape, /@{item\.username/);
  assert.match(activityTape, /points\.activity\.tapeBought/);
  assert.match(activityTape, /points\.activity\.tapeSold/);
  assert.match(activityTape, /formatMoney\(item\.collateral/);
  assert.match(activityTape, /function priceMovementLabel/);
  assert.match(activityTape, /item\.priceBefore/);
  assert.match(activityTape, /item\.priceAfter/);
  assert.match(activityTape, /item\.priceMin/);
  assert.match(activityTape, /item\.priceMax/);
  assert.match(activityTape, /showTradeDetails = false/);
  assert.match(activityTape, /const fills = Array\.isArray\(item\.fills\) \? item\.fills : \[\]/);
  assert.match(activityTape, /const canShowDetails = showTradeDetails && fills\.length > 1/);
  assert.match(activityTape, /expandedTradeRows/);
  assert.doesNotMatch(carousel, /showTradeDetails=\{true\}|showTradeDetails=\{isAdmin\}/);
  assert.doesNotMatch(activityTape, /orderBookSource|source ===|AMM|maker/i);
});

test('an empty poll never blanks a slide already on screen', () => {
  assert.match(carousel, /!Array\.isArray\(buckets\) \|\| buckets\.length === 0/);
});

test('the pinned market states it has no buys instead of implying activity', () => {
  // The live BTC rollover is admitted on price movement, not fills. It must
  // not wear a generic rank it did not earn, and its empty flow panel must say why.
  assert.match(carousel, /_pinned: true/);
  assert.match(carousel, /m\._pinned\s*\?\s*t\('points\.activity\.slotBtc'\)/);
  assert.match(carousel, /points\.activity\.noBuys/);
});

test('home caps the carousel at seven hidden editorial slots', () => {
  assert.match(home, /<PointsActivityCarousel markets=\{carouselMarkets\} count=\{7\} \/>/);
  assert.match(home, /Seven hidden editorial slots/);
});
