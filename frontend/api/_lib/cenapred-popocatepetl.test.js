import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CENAPRED_POPOCATEPETL_SOURCE,
  parseCenapredPopocatepetlReport,
  popocatepetlResolveAt,
  popocatepetlResolverConfig,
  readCenapredPopocatepetlExhalations,
  upgradeLegacyPopocatepetlResolver,
} from './cenapred-popocatepetl.js';
import { priceBucketIndexFor } from './price-buckets.js';

const TARGET = '2026-10-08';
const NOW = Date.parse('2026-10-09T06:00:00Z');
const REPORT_PATH = '/cenapred/es/articulos/monitoreo-del-volcan-popocatepetl-hoy-8-de-octubre-de-2026';
const TITLE = 'Monitoreo del volc\u00e1n Popocat\u00e9petl, hoy 8 de octubre de 2026';

function report(body = 'Se detectaron&nbsp;<strong>42 exhalaciones</strong>.', day = 8) {
  return `<html><body><aside>Se detectaron 999 exhalaciones el 7 de octubre de 2026.</aside>
    <main><h1>Monitoreo del volc\u00e1n Popocat\u00e9petl, hoy ${day} de octubre de 2026</h1>
    <section><p>Centro Nacional de Prevenci\u00f3n de Desastres | ${day} de octubre de 2026</p></section>
    <div class="article-body"><p>${body}</p></div></main></body></html>`;
}

function archive(rows = [{ path: REPORT_PATH, title: TITLE, time: '2026-10-08 11:00:00' }], next = false) {
  return `<html><body>${rows.map(row => `<article><time date="${row.time}"></time>
    <h2>${row.title}</h2><a href="${row.path}">Continuar leyendo</a></article>`).join('')}
    ${next ? '<a rel="next" href="?page=2">2</a>' : ''}</body></html>`;
}

function htmlResponse(html, options = {}) {
  return new Response(html, { headers: { 'content-type': 'text/html' }, ...options });
}

test('CENAPRED parser reads the exact dated report body, not the sidebar or image caption', () => {
  const html = report().replace('<div class="article-body">', '<img alt="Se detectaron 100 exhalaciones"><div class="article-body">');
  const parsed = parseCenapredPopocatepetlReport(html, TARGET);
  assert.equal(parsed.count, 42);
  assert.equal(parsed.reportDateYmd, TARGET);
  assert.equal(parsed.reportTitle, TITLE);
});

test('CENAPRED parser rejects stale dates, absent attribution, noninteger counts and ambiguous text', () => {
  assert.throws(() => parseCenapredPopocatepetlReport(report(undefined, 7), TARGET), /date_mismatch/);
  assert.throws(() => parseCenapredPopocatepetlReport(report().replace('Desastres', 'Periodistas'), TARGET), /attribution/);
  assert.throws(() => parseCenapredPopocatepetlReport(report('Semaforo Amarillo Fase 2.'), TARGET), /missing_exhalation/);
  for (const count of ['3.5', '-42', '2,5', '1.234', '9007199254740992']) {
    assert.throws(() => parseCenapredPopocatepetlReport(report(`Se detectaron ${count} exhalaciones.`), TARGET), /non_integer/);
  }
  assert.throws(() => parseCenapredPopocatepetlReport(report('Se detectaron 42 exhalaciones. Ayer se registraron 35 exhalaciones.'), TARGET), /ambiguous/);
});

test('CENAPRED parser handles explicit zero and integer thousands', () => {
  for (const [body, count] of [['Se detectaron 0 exhalaciones.', 0], ['No se detectaron exhalaciones.', 0], ['Se registraron un total de 1,234 exhalaciones.', 1234]]) {
    assert.equal(parseCenapredPopocatepetlReport(report(body), TARGET).count, count);
  }
});

test('Popocatepetl buckets have no gaps at inclusive integer endpoints', () => {
  const cfg = popocatepetlResolverConfig(TARGET);
  for (const [count, index] of [[0, 0], [19, 0], [20, 1], [49, 1], [50, 2], [99, 2], [100, 3], [500, 3]]) {
    assert.equal(priceBucketIndexFor(count, cfg.buckets), index);
  }
  assert.equal(priceBucketIndexFor(-1, cfg.buckets), -1);
  assert.equal(cfg.resolveAt, '2026-10-09T06:00:00.000Z');
  assert.equal(popocatepetlResolveAt('2026-10-31'), '2026-11-01T06:00:00.000Z');
  assert.equal(popocatepetlResolveAt('2028-02-29'), '2028-03-01T06:00:00.000Z');
  assert.throws(() => popocatepetlResolveAt('2026-02-30'), /invalid_report_date/);
});

test('CENAPRED reader waits for the same-day correction window and respects a later configured time', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = () => { throw new Error('should_not_fetch'); };
  await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET, resolveAt: '2026-10-08T19:00:00Z' }, { now: NOW - 1 }), error => error.benign === true && error.message === 'price_resolution_not_ready');
  await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET, resolveAt: '2026-10-09T07:00:00Z' }, { now: NOW }), /price_resolution_not_ready/);
});

test('CENAPRED reader discovers the correct report even when its URL slug has the wrong day', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const irregular = '/cenapred/es/articulos/monitoreo-del-volcan-popocatepetl-hoy-7-de-octubre-de-2026-123456';
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.headers.accept, 'text/html');
    assert.equal(options.redirect, 'manual');
    if (String(url).includes('/archivo/')) return htmlResponse(archive([{ path: irregular, title: TITLE, time: '2026-10-08 11:00:00' }]));
    assert.equal(String(url), `https://www.gob.mx${irregular}`);
    return htmlResponse(report());
  };
  const result = await readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW });
  assert.equal(calls.length, 2);
  assert.equal(result.value, 42);
  assert.equal(result.source, CENAPRED_POPOCATEPETL_SOURCE);
  assert.equal(result.sourceUrl, `https://www.gob.mx${irregular}`);
  assert.equal(result.reportPublishedAt, '2026-10-08T17:00:00.000Z');
});

test('CENAPRED reader uses the last same-day update and completes pagination through the target day', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('page=1')) return htmlResponse(archive([
      { path: `${REPORT_PATH}-actualizacion`, title: `Actualizaci\u00f3n del ${TITLE}`, time: '2026-10-08 19:00:00' },
    ], true));
    if (String(url).includes('page=2')) return htmlResponse(archive([
      { path: REPORT_PATH, title: TITLE, time: '2026-10-08 11:00:00' },
      { path: '/cenapred/articulos/old', title: TITLE.replace('8 de', '7 de'), time: '2026-10-07 11:00:00' },
    ], true));
    assert.ok(String(url).endsWith('-actualizacion'));
    return htmlResponse(report('Se detectaron 50 exhalaciones.'));
  };
  const result = await readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW });
  assert.equal(result.count, 50);
  assert.equal(result.reportPublishedAt, '2026-10-09T01:00:00.000Z');
  assert.equal(calls.length, 3);
});

test('CENAPRED reader defers unavailable, blocked, stale and malformed official reports', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const response of [
    () => htmlResponse('Forbidden', { status: 403 }),
    () => htmlResponse('<html>Challenge</html>'),
    () => new Response("$('#prensa').append('...')", { headers: { 'content-type': 'text/javascript' } }),
    () => htmlResponse(archive([{ path: REPORT_PATH, title: TITLE.replace('8 de', '7 de'), time: '2026-10-07 11:00:00' }])),
  ]) {
    globalThis.fetch = async () => response();
    await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW }), error => error.benign === true && error.info.targetDateYmd === TARGET);
  }
  globalThis.fetch = async (url) => htmlResponse(String(url).includes('/archivo/') ? archive() : report(undefined, 7));
  await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW }), error => error.benign === true && /report_date_mismatch/.test(error.message));
});

test('CENAPRED reader rejects external URLs and redirects before fetching them', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return htmlResponse(archive([{ path: 'https://example.com/report', title: TITLE, time: '2026-10-08 11:00:00' }]));
  };
  await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW }), /non_official_url/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW }), /non_official_url/);
});

test('CENAPRED reader defers if equally recent reports conflict', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    if (String(url).includes('/archivo/')) return htmlResponse(archive([
      { path: REPORT_PATH, title: TITLE, time: '2026-10-08 11:00:00' },
      { path: `${REPORT_PATH}-duplicate`, title: TITLE, time: '2026-10-08 11:00:00' },
    ]));
    return htmlResponse(report(`Se detectaron ${String(url).endsWith('-duplicate') ? 50 : 42} exhalaciones.`));
  };
  await assert.rejects(readCenapredPopocatepetlExhalations({ targetDateYmd: TARGET }, { now: NOW }), /conflicting_latest_reports/);
});

test('legacy upgrade only changes resolver settings for unchanged generated Popocatepetl markets', () => {
  const legacy = {
    resolverType: 'manual_review', source: 'october-tournament-2026',
    sourceEventId: `october-2026:popocatepetl-exhalations-${TARGET}`,
    cfg: { source: 'october-tournament-2026', shape: 'manual', criteria: 'CENAPRED exhalaciones', resolveAt: '2026-10-08T19:00:00Z' },
    sourceData: { kind: 'october_tournament_popocatepetl', targetDateYmd: TARGET },
    outcomes: ['0 a 19', '20 a 49', '50 a 99', '100 o m\u00e1s'],
  };
  const original = structuredClone(legacy);
  const cfg = upgradeLegacyPopocatepetlResolver(legacy);
  assert.equal(cfg.source, CENAPRED_POPOCATEPETL_SOURCE);
  assert.equal(cfg.resolveAt, '2026-10-09T06:00:00.000Z');
  assert.equal(cfg.criteria, legacy.cfg.criteria);
  assert.deepEqual(legacy, original);
  for (const modified of [
    { source: 'manual' }, { sourceEventId: 'october-2026:wti-usd-close' },
    { resolverType: 'api_price' }, { outcomes: ['0 a 29', ...legacy.outcomes.slice(1)] },
    { sourceData: { targetDateYmd: '2026-10-07' } }, { cfg: { ...legacy.cfg, source: 'manual' } },
  ]) assert.equal(upgradeLegacyPopocatepetlResolver({ ...legacy, ...modified }), null);
  assert.equal(upgradeLegacyPopocatepetlResolver({ ...legacy, cfg: { ...legacy.cfg, resolveAt: '2026-10-09T18:00:00Z' } }).resolveAt, '2026-10-09T18:00:00Z');
});
