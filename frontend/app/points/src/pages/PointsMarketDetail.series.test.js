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
  assert.match(source, /const ringIndex = isResolved && winnerIndex != null \? winnerIndex : 0;/);
  assert.match(source, /pct=\{pctFor\(ringIndex\)\}/);
  assert.match(source, /label=\{outcomes\[ringIndex\]\}/);
  assert.match(source, /winner=\{isResolved && winnerIndex === ringIndex\}/);
});

test('points series strip uses translated game and summary copy', () => {
  assert.doesNotMatch(source, /Game \{item\.gameNumber\}/);
  assert.doesNotMatch(source, /`Game \$\{item\.gameNumber\}`/);
  assert.match(source, /formatSeriesGameLabel\(item\.gameNumber, \{ t \}\)/);
  assert.match(source, /formatSeriesScoreSummary\(seriesMeta, \{ t \}\)/);
  assert.match(source, /formatSeriesSubtitle\(market\.seriesMeta, \{ t \}\)/);
});
