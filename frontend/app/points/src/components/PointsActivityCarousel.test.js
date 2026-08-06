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
  // All-time volume only builds the shortlist; fills inside the window decide.
  assert.match(carousel, /\.filter\(m => m\._count > 0\)/);
  assert.match(carousel, /const WINDOW_HOURS = 24/);
});

test('flow counts both sides of a binary market', () => {
  // A buy on NO still moves the YES price, so outcome=0 would hide half
  // the flow the panel claims to summarize.
  assert.match(carousel, /outcome: 'all'/);
});

test('an empty poll never blanks a slide already on screen', () => {
  assert.match(carousel, /!Array\.isArray\(buckets\) \|\| buckets\.length === 0/);
});

test('the pinned market states it has no buys instead of implying activity', () => {
  // The live BTC rollover is admitted on price movement, not fills. It must
  // not wear a rank it did not earn, and its empty flow panel must say why.
  assert.match(carousel, /_pinned: true/);
  assert.match(carousel, /m\._pinned\s*\?\s*t\('points\.activity\.moving'\)/);
  assert.match(carousel, /points\.activity\.noBuys/);
});

test('home caps the carousel at five slides', () => {
  assert.match(home, /<PointsActivityCarousel markets=\{markets\} count=\{5\} \/>/);
});
