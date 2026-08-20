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
  assert.match(pageSource, /Terminal/);
  assert.match(pageSource, /Sala/);
  assert.match(pageSource, /Demora/);
  assert.match(pageSource, /delayVerdict/);
  assert.match(pageSource, /delayMinutesLabel/);
  assert.match(pageSource, /delayMinutes/);
  assert.match(pageSource, /boardStatusLabel/);
  assert.match(pageSource, /resolverCounters/);
  assert.match(pageSource, />30 min demorado/);
  assert.match(pageSource, /Última hora/);
  assert.match(pageSource, /Ventanas de mercado/);
  assert.match(pageSource, /Cada 60 min/);
  assert.match(pageSource, /24 horas/);
  assert.match(pageSource, /48 horas/);
  assert.match(pageSource, /7 días/);
  assert.match(pageSource, /findDailyAicmMarket/);
  assert.match(pageSource, /AICM_DELAY_SOURCES/);
  assert.match(pageSource, /from '..\/lib\/aicmMarkets\.js'/);
  assert.match(pageSource, /acceptedWindows = new Set\(\['day', '48h'\]\)/);
  assert.match(pageSource, /sourceEventId/);
});

test('AICM departures board renders the full overview row set', () => {
  assert.match(pageSource, /const visible = rows;/);
  assert.doesNotMatch(pageSource, /rows\.slice\(0, 14\)/);
  assert.match(pageSource, /overflowY: 'auto'/);
  assert.match(pageSource, /scrollbarGutter: 'stable'/);
  assert.match(pageSource, /shownFlights/);
  assert.match(pageSource, /totalFlights/);
  assert.match(pageSource, /hiddenClosedFlights/);
  assert.match(pageSource, /hiddenStaleFlights/);
  assert.match(pageSource, /cerrados ocultos/);
  assert.match(pageSource, /salidas vencidas ocultas/);
  assert.match(pageSource, /closedGraceMinutes/);
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
  assert.match(pageSource, /<CounterCard label="Última hora" title="demoras medidas" counter=\{counters\.hour\} footerLabel="vuelos medidos AE" \/>/);
  assert.match(pageSource, /<CounterCard label="Hoy" title="demoras medidas" counter=\{counters\.day\} footerLabel="vuelos medidos AE" \/>/);
  assert.match(pageSource, /<CounterCard label="7 días" title="demoras medidas" counter=\{counters\.week\} footerLabel="vuelos medidos AE" \/>/);
  assert.match(pageSource, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(min\(100%, 180px\), 1fr\)\)'/);
  assert.match(pageSource, /valueKey="thresholdFlights"/);
});
