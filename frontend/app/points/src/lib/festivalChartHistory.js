import { normalizePricePoints } from '../../../src/lib/cryptoChartMath.js';

const TICK_COVERAGE_MS = 10_000;

function tickCoverage(points) {
  return new Set(points.map(point => Math.floor(point.t / TICK_COVERAGE_MS)));
}

function outsideCoverage(point, coverage) {
  const bucket = Math.floor(point.t / TICK_COVERAGE_MS);
  return !coverage.has(bucket - 1) && !coverage.has(bucket) && !coverage.has(bucket + 1);
}

export function buildFestivalPriceHistory({ bars, ticks, live, from, to, opening, closing }) {
  const inRange = point => Number.isFinite(point.t) && Number.isFinite(point.price)
    && point.price > 0 && point.t >= from && point.t <= to;
  const observed = live.filter(inRange);
  const observedCoverage = tickCoverage(observed);
  const backfill = ticks.filter(point => inRange(point) && outsideCoverage(point, observedCoverage));
  const tickBuckets = tickCoverage([...observed, ...backfill]);
  const fallback = bars.filter(point => inRange(point) && outsideCoverage(point, tickBuckets));
  const anchors = [opening, closing].filter(point => point && inRange(point));
  return normalizePricePoints([...fallback, ...backfill, ...observed, ...anchors]);
}
