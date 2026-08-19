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
  assert.match(pageSource, /MEX Salidas/);
  assert.match(pageSource, /Aerolínea/);
  assert.match(pageSource, /Demora/);
  assert.match(pageSource, /delayVerdict/);
  assert.match(pageSource, /boardStatusLabel/);
  assert.match(pageSource, /Última hora/);
  assert.match(pageSource, /Ventanas de mercado/);
  assert.match(pageSource, /Cada 60 min/);
  assert.match(pageSource, /24 horas/);
  assert.match(pageSource, /48 horas/);
  assert.match(pageSource, /7 días/);
  assert.match(pageSource, /findDailyAicmMarket/);
  assert.match(pageSource, /AICM_DELAY_SOURCES/);
  assert.match(pageSource, /'aviation-edge-timetable'/);
  assert.match(pageSource, /acceptedWindows = new Set\(\['day', '48h'\]\)/);
  assert.match(pageSource, /sourceEventId/);
});

test('AICM departures board renders the full overview row set', () => {
  assert.match(pageSource, /const visible = rows;/);
  assert.doesNotMatch(pageSource, /rows\.slice\(0, 14\)/);
  assert.match(pageSource, /shownFlights/);
  assert.match(pageSource, /totalFlights/);
});

test('AICM hub places the departures board before the weekly rhythm card', () => {
  assert.ok(pageSource.indexOf('<Timetable rows={timetable} board={overview?.board} source={source} />') > 0);
  assert.ok(pageSource.indexOf('<DailyBars rows={dailyRows} />') > 0);
  assert.ok(
    pageSource.indexOf('<Timetable rows={timetable} board={overview?.board} source={source} />')
      < pageSource.indexOf('<DailyBars rows={dailyRows} />')
  );
});

test('AICM hub uses a navy airport palette with neutral delay counters', () => {
  assert.match(pageSource, /AEROMEXICO_NAVY = '#040C3E'/);
  assert.match(pageSource, /ACCENTS\.neutral/);
  assert.match(pageSource, /<CounterCard label="Última hora" title="salidas demoradas" counter=\{counters\.hour\} \/>/);
  assert.match(pageSource, /<CounterCard label="Hoy" title="salidas demoradas" counter=\{counters\.day\} \/>/);
  assert.match(pageSource, /<CounterCard label="7 días" title="salidas demoradas" counter=\{counters\.week\} \/>/);
});
