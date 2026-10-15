import test from 'node:test';
import assert from 'node:assert/strict';
import { INPC_FIRST_RELEASE_CRITERIA, INPC_RELEASE_OUTCOMES, parseInitialInpcRelease, readInitialInpcRelease } from './inegi-inpc-release.js';
import { readOfficialResult, upgradeLegacyOfficialResult } from './official-results.js';

const NOW = new Date('2026-10-23T19:00:00Z');
const CFG = { source: 'official-result', kind: 'inegi-inpc-first-release', targetPeriod: '2026-10-1Q', resolveAt: '2026-10-23T18:00:00Z' };

function release(rate = '3.50') {
  return {
    programa: 'Índice Nacional de Precios al Consumidor (INPC). Actualización de Canasta y Ponderadores 2024',
    periodoInformacion: 'Primera quincena de Octubre     de 2026', fechaInformacion: '22/10/2026', fechaPublicacion: '22 de octubre de 2026',
    titulo: `La inflación anual fue de ${rate}% en la primera quincena de octubre de 2026`,
    resumenNoticia: `<p>En la primera quincena de octubre de 2026, el INPC aumentó 0.11 %. Con este resultado, la inflaci&oacute;n general anual se ubic&oacute; en ${rate} por ciento. En 2025 fue de 3.63 por ciento.</p><p>La inflación subyacente fue de 4.20 %.</p>`,
    urlPdf: '/saladeprensa/boletines/2026/inpc/inpc_1q2026_10.pdf', estatusInformacion: '',
  };
}

function listing(row = release(), id = '12345') {
  return { idNoticia: id, titulo: row.programa, subtitulo: row.titulo, periodo: row.periodoInformacion, fecha: row.fechaInformacion };
}

function fetchNews(row = release(), rows = [listing(row)]) {
  return async (url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.match(url, /^https:\/\/www\.inegi\.org\.mx\/app\/api\/saladeprensa\/api\/saladeprensa\//);
    const details = url.includes('/ObtenerInfoNoticia/');
    if (!details) {
      assert.equal(options.body.get('token'), 'INPC');
      assert.equal(options.body.get('fechaDesde'), '2026-10-01');
      assert.equal(options.body.get('fechaHasta'), '2026-10-31');
    }
    return { ok: true, text: async () => JSON.stringify(details ? [row] : rows) };
  };
}

test('initial inflation release checks period, first bulletin and matching annual rate, not underlying or prior-year rates', () => {
  const result = parseInitialInpcRelease(release(), CFG.targetPeriod, NOW);
  assert.equal(result.annualRate, 3.5);
  assert.equal(result.publicationDate, '2026-10-22');
  assert.match(result.bulletinUrl, /\/contenidos\/saladeprensa\/boletines\/2026\/inpc\/inpc_1q2026_10.pdf$/);
  assert.match(result.releaseHash, /^[a-f0-9]{64}$/);
  for (const row of [
    { ...release(), periodoInformacion: 'Segunda quincena de Octubre de 2026' },
    { ...release(), programa: 'Índice Nacional de Precios Productor (INPP)' },
    { ...release(), urlPdf: '/saladeprensa/boletines/2026/inpc/inpc_2q2026_10.pdf' },
    { ...release(), titulo: release().titulo.replace('3.50', '3.99') },
    { ...release(), resumenNoticia: '<p>La inflación subyacente anual fue de 3.50 por ciento.</p>' },
    { ...release(), fechaInformacion: '22/11/2026' },
    { ...release(), fechaPublicacion: '23 de octubre de 2026' },
    { ...release(), estatusInformacion: 'Cifras revisadas' },
  ]) assert.throws(() => parseInitialInpcRelease(row, CFG.targetPeriod, NOW), error => error.benign && error.manualReview);
  assert.throws(() => parseInitialInpcRelease(release(), CFG.targetPeriod, new Date('2026-10-21T18:00:00Z')), /publication/);
});

test('official initial inflation reader maps exact boundaries and retains evidence', async () => {
  for (const [rate, expected] of [['2.99', 0], ['3.00', 1], ['3.49', 1], ['3.50', 2], ['3.99', 2], ['4.00', 3]]) {
    const result = await readOfficialResult(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: fetchNews(release(rate)), now: NOW });
    assert.equal(result.winningIdx, expected);
    assert.match(result.resolverInfo.evidenceUrl, /noticia\/12345$/);
    assert.equal(result.resolverInfo.targetPeriod, '2026-10-1Q');
  }
});

test('inflation release missing, conflicting or revised evidence cannot settle', async () => {
  await assert.rejects(() => readInitialInpcRelease(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: () => assert.fail('not yet due'), now: new Date('2026-10-23T17:00:00Z') }), /not_due/);
  await assert.rejects(() => readInitialInpcRelease(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: fetchNews(release(), []), now: NOW }), error => error.benign && !error.manualReview);
  await assert.rejects(() => readInitialInpcRelease(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: fetchNews(release(), []), now: new Date('2026-10-28T18:00:00Z') }), error => error.manualReview);
  await assert.rejects(() => readInitialInpcRelease(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: fetchNews(release(), [listing(), listing(release(), '54321')]), now: NOW }), error => error.manualReview);
  await assert.rejects(() => readInitialInpcRelease(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: fetchNews({ ...release(), estatusInformacion: 'Corregido' }), now: NOW }), /revision_not_allowed/);
  await assert.rejects(() => readInitialInpcRelease(CFG, INPC_RELEASE_OUTCOMES, { fetchImpl: fetchNews(release(), [{ ...listing(), subtitulo: 'Otro resultado' }]), now: NOW }), /listing_detail_conflict/);
});

test('legacy inflation upgrades preserve the exact published initial-release contract', () => {
  const market = { resolverType: 'manual_review', cfg: { criteria: INPC_FIRST_RELEASE_CRITERIA, resolveAt: CFG.resolveAt },
    source: 'october-tournament-2026', sourceEventId: 'october-2026:inpc-first-half-october-annual-inflation', outcomes: INPC_RELEASE_OUTCOMES };
  const upgraded = upgradeLegacyOfficialResult(market);
  assert.equal(upgraded.kind, 'inegi-inpc-first-release');
  assert.equal(upgraded.criteria, market.cfg.criteria);
  assert.equal(upgradeLegacyOfficialResult({ ...market, cfg: { criteria: market.cfg.criteria + ' Regla personalizada.' } }), null);
  assert.equal(upgradeLegacyOfficialResult({ ...market, outcomes: ['Sí', 'No'] }), null);
});
