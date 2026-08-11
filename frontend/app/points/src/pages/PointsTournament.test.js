import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pageSource = await readFile(new URL('./PointsTournament.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');

test('points app exposes a Torneo Pronos page between portfolio and earn', () => {
  assert.match(appSource, /PointsTournament/);
  assert.match(appSource, /path="\/torneo"/);
  assert.match(navSource, /to="\/portfolio"[\s\S]*to="\/torneo"[\s\S]*to="\/earn"/);
  assert.match(navSource, /points\.nav\.tournament/);
  assert.match(i18nSource, /'points\.nav\.tournament':\s*\{\s*es:\s*'Torneo Pronos'/);
});

test('tournament page shows current leaderboard, past leaderboards, countdown and rules', () => {
  assert.match(pageSource, /fetchCurrentCycle/);
  assert.match(pageSource, /fetchLeaderboard/);
  assert.match(pageSource, /fetchCycleHistory/);
  assert.match(pageSource, /Leaderboard actual/);
  assert.match(pageSource, /Leaderboards anteriores/);
  assert.match(pageSource, /Cuenta regresiva/);
  assert.match(pageSource, /Nuevos mercados para el torneo/);
  assert.match(pageSource, /Todos los días a las 9:00 AM, hora de Ciudad de México/);
  assert.match(pageSource, /200 MXNP agregados al inicio/);
  assert.match(pageSource, /50 MXNP por persona referida, máximo 10 referidos/);
  assert.match(pageSource, /premios aprobados de Instagram, TikTok, X y campañas/);
  assert.match(pageSource, /nextTournamentMarketDropIso/);
  assert.match(pageSource, /America\/Mexico_City/);
  assert.match(pageSource, /Reglas/);
  assert.match(pageSource, /Preguntas frecuentes/);
  assert.match(pageSource, /¿Qué significa PnL\?/);
  assert.match(pageSource, /PnL significa ganancia o pérdida/);
  assert.match(pageSource, /What does PnL mean\?/);
  assert.match(pageSource, /qualifyingMarkets:\s*10/);
});

test('points app records authenticated site-time pulses from the router', () => {
  assert.match(appSource, /PointsSiteTimeTracker/);
  assert.match(appSource, /\/api\/points\/analytics\/pulse/);
  assert.match(appSource, /visibilitychange/);
});
