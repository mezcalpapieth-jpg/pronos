import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parseGdpBulletinXml, readInitialGdpRelease } from './inegi-gdp-release.js';
import { GDP_OUTCOMES, automaticConfig } from './automated-market-rules.js';
import { readOfficialResult } from './official-results.js';

const cell = (value, span = 1) => `<w:tc><w:tcPr><w:gridSpan w:val="${span}"/></w:tcPr><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const row = values => `<w:tr>${values.map(value => Array.isArray(value) ? cell(...value) : cell(value)).join('')}</w:tr>`;
export function bulletin(value = '1.0') {
  return `<w:document xmlns:w="urn:word"><w:body><w:p><w:r><w:t>I. CIFRAS DESESTACIONALIZADAS: 9.9%</w:t></w:r></w:p>
    <w:p><w:r><w:t>Cuadro 2 cifras originales al tercer trimestre de 2026 (variación porcentual real anual)</w:t></w:r></w:p>
    <w:tbl>${row(['pib y actividades económicas', ['20251/', 4], ['2026', 4]])}
    ${row(['', '2.°', '3.er', '4.°', 'Anual', '1.er', '2.°', '3.er2/', '92/meses'])}
    ${row(['pib', '-0.1', '-0.2', '1.7', '0.5', '0.2', '2.2', value, '7.7'])}</w:tbl></w:body></w:document>`;
}
const detail = {
  programa: 'Estimación Oportuna del PIB Trimestral. Base 2018', periodoInformacion: 'Tercer trimestre de 2026',
  fechaInformacion: '30/10/2026', fechaPublicacion: '30 de octubre de 2026', titulo: 'PIB oportuno Q3',
  resumenNoticia: '<p>Cifras ajustadas por estacionalidad: 9.9%</p>',
  urlPdf: '/saladeprensa/boletines/2026/pibo/pib_eo2026_10.pdf', urlDoc: '/saladeprensa/boletines/2026/pibo/pib_eo2026_10.docx',
};
const cfg = { targetPeriod: '2026-Q3', resolveAt: '2026-10-30T14:00:00Z' };
function fetcher({ value = '1.0', override = {}, listing = null } = {}) {
  return async url => {
    if (url.endsWith('.docx')) return new Response(zipSync({ 'word/document.xml': strToU8(bulletin(value)) }));
    if (url.includes('ObtenerInfoNoticia')) return new Response(JSON.stringify([{ ...detail, ...override }]));
    return new Response(JSON.stringify(listing || [{ idNoticia: '1234', periodo: 'Tercer trimestre de 2026',
      titulo: detail.programa, subtitulo: detail.titulo, fecha: detail.fechaInformacion }]));
  };
}

test('GDP uses original annual GDP column, not adjusted, earlier quarters or cumulative column', () => {
  assert.equal(parseGdpBulletinXml(bulletin(), '2026-Q3'), 1);
  assert.equal(parseGdpBulletinXml(bulletin('-1.2'), '2026-Q3'), -1.2);
  assert.throws(() => parseGdpBulletinXml(bulletin().replace('cifras originales', 'cifras ajustadas'), '2026-Q3'), /ambiguous/);
  assert.throws(() => parseGdpBulletinXml(bulletin(), '2025-Q3'), /ambiguous/);
  assert.throws(() => parseGdpBulletinXml(bulletin().replace('3.er2/', 'Anual'), '2026-Q3'), /ambiguous/);
});

test('GDP initial-release reader maps exact inclusive boundaries without rounding', async () => {
  for (const [value, expected] of [['0.499', 0], ['0.5', 1], ['1.0', 2], ['3.499', 6], ['3.5', 7]]) {
    const result = await readInitialGdpRelease(cfg, GDP_OUTCOMES, { fetchImpl: fetcher({ value }), now: new Date('2026-10-30T18:00:00Z') });
    assert.equal(result.winningIdx, expected);
    assert.equal(result.resolverInfo.annualRate, Number(value));
    assert.match(result.resolverInfo.releaseHash, /^[a-f0-9]{64}$/);
  }
});

test('GDP delays wait; wrong period, future publication and corrections cannot settle', async () => {
  const read = options => readInitialGdpRelease(cfg, GDP_OUTCOMES, { fetchImpl: fetcher(options), now: new Date('2026-10-30T18:00:00Z') });
  await assert.rejects(read({ listing: [] }), e => e.benign && !e.manualReview);
  await assert.rejects(read({ override: { periodoInformacion: 'Segundo trimestre de 2026' } }), /identity/);
  await assert.rejects(read({ override: { estatusInformacion: 'Corregido' } }), /revision/);
  await assert.rejects(readInitialGdpRelease(cfg, GDP_OUTCOMES, { fetchImpl: fetcher(), now: new Date('2026-10-29T18:00:00Z') }), /date/);
  await assert.rejects(readInitialGdpRelease(cfg, ['one'], { fetchImpl: fetcher() }), /outcomes/);
});

test('GDP accepts a delayed first publication in the next month, not a different reference period', async () => {
  const override = { fechaInformacion: '02/11/2026', fechaPublicacion: '2 de noviembre de 2026',
    urlPdf: '/saladeprensa/boletines/2026/pibo/pib_eo2026_11.pdf', urlDoc: '/saladeprensa/boletines/2026/pibo/pib_eo2026_11.docx' };
  const listing = [{ idNoticia: '1234', periodo: detail.periodoInformacion, titulo: detail.programa,
    subtitulo: detail.titulo, fecha: override.fechaInformacion }];
  const result = await readInitialGdpRelease(cfg, GDP_OUTCOMES, { fetchImpl: fetcher({ override, listing }), now: new Date('2026-11-02T18:00:00Z') });
  assert.equal(result.winningIdx, 2);
  assert.equal(result.resolverInfo.publicationDate, '2026-11-02');
});

test('GDP official dispatch enforces approved rules and cannot settle an Admin-modified criterion', async () => {
  const automatic = automaticConfig('inegi-gdp-first-release', cfg);
  const deps = { fetchImpl: fetcher(), now: new Date('2026-10-30T18:00:00Z') };
  assert.equal((await readOfficialResult(automatic, GDP_OUTCOMES, deps)).winningIdx, 2);
  await assert.rejects(readOfficialResult({ ...automatic, criteria: 'Use adjusted GDP' }, GDP_OUTCOMES,
    { ...deps, fetchImpl: () => assert.fail('fetch for modified contract') }), e => e.manualReview && /modified/.test(e.message));
});
