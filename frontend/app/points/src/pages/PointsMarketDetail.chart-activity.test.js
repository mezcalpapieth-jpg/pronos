/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.chart-activity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');

test('points market detail overlays real activity and range controls on the chart', () => {
  assert.match(detailSource, /fetchTradeActivity/);
  assert.match(detailSource, /DETAIL_CHART_RANGES/);
  assert.match(detailSource, /points\.detail\.range24h/);
  assert.match(detailSource, /points\.detail\.range7d/);
  assert.match(detailSource, /points\.detail\.range30d/);
  assert.match(detailSource, /chartRangeTouchedRef/);
  assert.match(detailSource, /market\.status === 'resolved' \? '30' : '1'/);
  assert.match(detailSource, /activityByOutcome/);
  assert.match(detailSource, /activity=\{displayActivityByOutcome\?\.\[0\] \|\| \[\]\}/);
  assert.match(detailSource, /activity=\{displayActivityByOutcome\?\.\[i\] \|\| \[\]\}/);
  assert.match(detailSource, /orderBookRefresh/);
});

test('points API client exposes anonymous trade activity endpoint', () => {
  assert.match(apiSource, /export async function fetchTradeActivity/);
  assert.match(apiSource, /\/api\/points\/trade-activity\?/);
  assert.match(apiSource, /buckets: String\(buckets\)/);
});

test('chart range copy is translated', () => {
  assert.match(i18nSource, /'points\.detail\.chartRange'/);
  assert.match(i18nSource, /'points\.detail\.range24h'/);
  assert.match(i18nSource, /'points\.detail\.range7d'/);
  assert.match(i18nSource, /'points\.detail\.range30d'/);
});
