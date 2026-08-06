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

test('carousel reads the existing trade-activity feed, not a parallel endpoint', () => {
  // /api/points/trade-activity already backs the market detail chart and is
  // deliberately anonymous. A second fills endpoint would both duplicate it
  // and leak usernames it chose not to expose.
  assert.match(carousel, /fetchTradeActivity/);
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

test('flow sell amounts render as human-readable negative values', () => {
  assert.match(carousel, /-\{formatCompact\(sell\)\}/);
  assert.doesNotMatch(carousel, /\\u2212\{formatCompact\(sell\)\}/);
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
  assert.match(home, /<PointsActivityCarousel markets=\{markets\} count=\{7\} \/>/);
  assert.match(home, /Seven hidden editorial slots/);
});
