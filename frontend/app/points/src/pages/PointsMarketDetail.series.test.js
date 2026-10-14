/**
 * Static checks for points market-detail series display.
 *
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.series.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');

test('points resolved binary ring follows the winning outcome', () => {
  assert.match(source, /const displayWinnerIndex = isResolved \? displayOutcomeIndices\.indexOf\(winnerIndex\) : null;/);
  assert.match(source, /const displayWinnerIndexes = isResolved && market\.ammMode === 'parallel'/);
  assert.match(source, /Number\(leg\?\.outcome\) === 0 \? index : null/);
  assert.match(source, /if \(isResolved\) \{[\s\S]*?return displayWinnerIndex === i \? 100 : 0;[\s\S]*?\}/);
  assert.match(source, /market\.ammMode === 'parallel' && Array\.isArray\(parallelDisplayLegs\)/);
  assert.match(source, /winnerIndex=\{displayWinnerIndexes\}/);
  assert.match(source, /displayWinnerIndexSet\.has\(i\)/);
});

test('points series strip uses translated game and summary copy', () => {
  assert.doesNotMatch(source, /Game \{item\.gameNumber\}/);
  assert.doesNotMatch(source, /`Game \$\{item\.gameNumber\}`/);
  assert.match(source, /formatSeriesGameLabel\(item\.gameNumber, \{ t \}\)/);
  assert.match(source, /formatSeriesScoreSummary\(seriesMeta, \{ t \}\)/);
  assert.match(source, /formatSeriesSubtitle\(market\.seriesMeta, \{ t \}\)/);
});

test('points series navigation sits immediately after the chart, before trading and activity', () => {
  const strip = source.indexOf('<SeriesGameStrip');
  assert.ok(strip > source.indexOf('<MarketActivityStrip'));
  assert.ok(strip < source.indexOf('{isMobile && tradePanel}'));
  assert.ok(strip < source.indexOf('<PointsActivityTape'));
  assert.ok(strip < source.indexOf('<OrderBookPanel'));
  assert.equal(source.match(/<SeriesGameStrip/g)?.length, 1);
});

test('points series navigation wraps all seven games instead of hiding them off-screen', () => {
  const strip = source.slice(source.indexOf('function SeriesGameStrip'), source.indexOf('function ProbabilityRing'));
  assert.match(strip, /role="navigation" aria-label=\{t\('points\.series\.label'\)\}/);
  assert.match(strip, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(84px, 1fr\)\)'/);
  assert.doesNotMatch(strip, /overflowX|minWidth: 122|WebkitOverflowScrolling/);
  assert.doesNotMatch(strip, /whiteSpace: 'nowrap'/);
  assert.match(strip, /disabled=\{!clickable\}/);
  assert.match(strip, /!item\.seriesLocked && item\.status !== 'pending' && item\.status !== 'not_needed'/);
});

test('points active binary detail keeps only the probability explainer comment', () => {
  assert.doesNotMatch(source, /t\('points\.detail\.probNow'\)/);
  assert.match(source, /t\('points\.detail\.probExplain'\)/);
  assert.match(source, /fontSize: 10,[\s\S]*?lineHeight: 1\.6/);
});
