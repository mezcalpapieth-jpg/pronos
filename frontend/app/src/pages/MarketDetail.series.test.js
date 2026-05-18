/**
 * Static checks for MVP market-detail series navigation.
 *
 * Run with:
 *   node --test frontend/app/src/pages/MarketDetail.series.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./MarketDetail.jsx', import.meta.url), 'utf8');

test('MVP detail renders the shared playoff series game strip', () => {
  assert.match(source, /function SeriesGameStrip/);
  assert.match(source, /function seriesGameStatus/);
  assert.match(source, /seriesMeta=\{market\.seriesMeta\}/);
  assert.match(source, /currentMarketId=\{market\.id\}/);
  assert.match(source, /navigate\(`\/market\?id=\$\{encodeURIComponent\(item\.id\)\}`\)/);
});

test('MVP series strip treats virtual completed games as final before pending placeholders', () => {
  const statusFn = source.slice(
    source.indexOf('function seriesGameStatus'),
    source.indexOf('function SeriesGameStrip'),
  );
  assert.match(statusFn, /item\?\.status === 'resolved'/);
  assert.match(statusFn, /item\?\.placeholder/);
  assert.ok(
    statusFn.indexOf("item?.status === 'resolved'") < statusFn.indexOf('item?.placeholder'),
    'resolved status must be checked before placeholder status',
  );
});

test('MVP resolved binary ring follows the winning outcome', () => {
  assert.match(source, /const displayWinnerIndex = isResolved \? displayOutcomeIndices\.indexOf\(winnerIndex\) : null;/);
  assert.match(source, /const ringIndex = isResolved && displayWinnerIndex != null && displayWinnerIndex >= 0 \? displayWinnerIndex : 0;/);
  assert.match(source, /if \(isResolved\) return displayWinnerIndex === i \? 100 : 0;/);
  assert.match(source, /pct=\{pctFor\(ringIndex\)\}/);
  assert.match(source, /label=\{displayOutcomes\[ringIndex\]\}/);
  assert.match(source, /winner=\{isResolved && displayWinnerIndex === ringIndex\}/);
});

test('MVP detail renders series labels in Spanish', () => {
  assert.doesNotMatch(source, /Game \{item\.gameNumber\}/);
  assert.doesNotMatch(source, /`Game \$\{item\.gameNumber\}`/);
  assert.match(source, /formatSeriesGameLabel\(item\.gameNumber\)/);
  assert.match(source, /formatSeriesScoreSummary\(seriesMeta\)/);
});
