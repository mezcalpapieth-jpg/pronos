import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const multi = await readFile(new URL('./MultiSparkline.jsx', import.meta.url), 'utf8');
const single = await readFile(new URL('./Sparkline.jsx', import.meta.url), 'utf8');
const detail = await readFile(
  new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8',
);
const carousel = await readFile(
  new URL('../../points/src/components/PointsActivityCarousel.jsx', import.meta.url), 'utf8',
);
const api = await readFile(
  new URL('../../../api/points/price-history.js', import.meta.url), 'utf8',
);

// Regression: on a 7-leg parallel market only the legs that traded get
// snapshots, so one leg's single 12h-old point stretched the axis back that
// far. Every recent trade then collapsed into a needle at the right edge and
// the stale leg drew a full-width flat line at its current price.
test('both charts accept an explicit time window', () => {
  assert.match(multi, /timeMin,\s*timeMax,/);
  assert.match(single, /timeMin,\s*timeMax,/);
});

test('an explicit time window takes precedence over fitting the axis to the data', () => {
  const guard = /if \(Number\.isFinite\(timeMin\) && Number\.isFinite\(timeMax\) && timeMax > timeMin\)\s*\{\s*return \{ min: timeMin, max: timeMax \};/;
  assert.match(multi, guard);
  assert.match(single, guard);
});

test('the data-driven fit stays as the fallback for callers that pass no window', () => {
  // Cards and the home grid pass no window and must keep the fitted axis.
  assert.match(multi, /return \{ min: timeMin, max: timeMax \};[\s\S]{0,500}Math\.min\(\.\.\.times\)/);
  assert.match(single, /return \{ min: timeMin, max: timeMax \};[\s\S]{0,500}Math\.min\(\.\.\.priceTimes\)/);
});

test('the timeBounds memo re-runs when the explicit window changes', () => {
  assert.match(multi, /\}, \[lines, useMovementAxis, timeMin, timeMax\]\)/);
  assert.match(single, /\}, \[hasTimestamps, points, useMovementAxis, timeMin, timeMax\]\)/);
});

test('a movement axis still ignores the time window entirely', () => {
  // xMode="movement" spaces points by index; a time window must not
  // resurrect the time axis for those callers.
  assert.match(multi, /if \(useMovementAxis\) return null;\s*\n\s*if \(Number\.isFinite\(timeMin\)/);
  assert.match(single, /if \(useMovementAxis\) return null;\s*\n\s*if \(!hasTimestamps\) return null;/);
});

test('the detail page pins both charts to the selected range window', () => {
  const pinned = detail.match(/timeMin=\{chartWindowStart\}\s*\n\s*timeMax=\{chartWindowEnd\}/g) || [];
  assert.equal(pinned.length, 2, 'both the binary and multi-outcome charts must be pinned');
});

test('the home carousel pins its charts to the window it actually fetched', () => {
  // The carousel fetches CHART_HISTORY_HOURS of history; the axis must
  // describe that same span rather than the snapshot extents.
  assert.match(
    carousel,
    /const mChartEnd = Math\.floor\(Date\.now\(\) \/ 1000\);\s*\n\s*const mRangeStart = mChartEnd - CHART_HISTORY_HOURS \* 3600;/,
  );
  const pinned = carousel.match(/timeMin=\{mChartStart\}\s*\n\s*timeMax=\{mChartEnd\}/g) || [];
  assert.equal(pinned.length, 2, 'both the binary and multi-outcome carousel charts must be pinned');
});

test('the window start and end derive from a single now', () => {
  // Two separate Date.now() reads would let the span drift off the range.
  assert.match(detail, /const chartWindowEnd = Math\.floor\(Date\.now\(\) \/ 1000\);\s*\n\s*const chartRangeStart = chartWindowEnd - \(/);
});

test('a market younger than the range charts its own life (Polymarket clamp)', () => {
  // Detail page: window start = max(range start, market open), so a
  // market created 8:22 gets an axis that starts 8:22.
  assert.match(
    detail,
    /const chartWindowStart = Number\.isFinite\(marketOpenedAt\)\s*\n\s*\? Math\.max\(chartRangeStart, Math\.min\(marketOpenedAt, chartWindowEnd - 60\)\)\s*\n\s*: chartRangeStart;/,
  );
  // Carousel: same clamp against the market's createdAt.
  assert.match(
    carousel,
    /const mChartStart = Number\.isFinite\(mOpenedAt\)\s*\n\s*\? Math\.max\(mRangeStart, Math\.min\(mOpenedAt, mChartEnd - 60\)\)\s*\n\s*: mRangeStart;/,
  );
});

test('the API carries the pre-window price forward to the window start', () => {
  // Older markets: the value at the window's left edge is the last price
  // BEFORE the window, clamped to the window start so it cannot stretch
  // any chart's axis into the past. Both price sources must contribute —
  // some markets' entire history lives in order-book fills, with zero
  // AMM snapshot rows (seen live on the Casa de los Famosos legs).
  assert.match(api, /AND snapshotted_at < NOW\(\) - \(\$\{windowHours\} \|\| ' hours'\)::interval/);
  assert.match(api, /ORDER BY market_id ASC, snapshotted_at DESC/);
  assert.match(api, /AND t\.created_at < NOW\(\) - \(\$\{windowHours\} \|\| ' hours'\)::interval/);
  assert.match(api, /ORDER BY t\.market_id ASC, t\.created_at DESC, t\.id DESC/);
  // The merge keeps whichever source is most recent, then pins it to the
  // window start.
  assert.match(api, /if \(!prev \|\| at > prev\.at\) boundary\.set\(r\.market_id, \{ at, p: projected \}\);/);
  assert.match(api, /t: windowStartSec,/);
});
