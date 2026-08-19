import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('./PointsAicmPage.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('AICM hub has a dedicated infrastructure route and public overview fetch', () => {
  assert.match(appSource, /PointsAicmPage/);
  assert.match(appSource, /path="\/c\/infraestructura\/aicm"/);
  assert.match(apiSource, /fetchAicmOverview/);
  assert.match(apiSource, /\/api\/points\/aicm\/overview/);
});

test('AICM hub renders the departures board, counters, and window cards', () => {
  assert.match(pageSource, /Pulso AICM/);
  assert.match(pageSource, /Tablero de salidas/);
  assert.match(pageSource, /Última hora/);
  assert.match(pageSource, /Ventanas de mercado/);
  assert.match(pageSource, /Cada 60 min/);
  assert.match(pageSource, /24 horas/);
  assert.match(pageSource, /7 días/);
  assert.match(pageSource, /findDailyAicmMarket/);
  assert.match(pageSource, /sourceEventId/);
});

test('AICM hub places the departures board before the weekly rhythm card', () => {
  assert.ok(pageSource.indexOf('<Timetable rows={timetable} />') > 0);
  assert.ok(pageSource.indexOf('<DailyBars rows={dailyRows} />') > 0);
  assert.ok(
    pageSource.indexOf('<Timetable rows={timetable} />')
      < pageSource.indexOf('<DailyBars rows={dailyRows} />')
  );
});
