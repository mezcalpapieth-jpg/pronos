import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGranjaVipWeeklyMarketSpec,
  extractParticipantsFromOfficialHtml,
  nextGranjaVipSundayClose,
  nextGranjaVipCapatazClose,
  parseOfficialGranjaArticle,
  readGranjaVipOfficialResult,
  readGranjaVipOfficialSnapshot,
} from './granja-vip-official.js';

const OFFICIAL_SECTION_HTML = `
  <main>
    <h3>Granjeros: La Granja VIP Segunda Temporada</h3>
    <a href="/aztecauno/la-granja-vip/carlos-trejo">Carlos Trejo</a>
    <a href="/aztecauno/la-granja-vip/ivonne-montero">Ivonne Montero</a>
    <a href="/aztecauno/la-granja-vip/kunno">Kunno</a>
    <a href="/aztecauno/la-granja-vip/mono-osuna">Mono Osuna</a>
    <a href="/aztecauno/la-granja-vip/pascal-nadaud">Pascal Nadaud</a>
    <a href="/aztecauno/la-granja-vip/pimpinela-escarlata">Pimpinela Escarlata</a>
    <h3>Conductores | La Granja VIP Segunda Temporada | Críticos</h3>
    <a href="/aztecauno/la-granja-vip/adal-ramones">Adal Ramones</a>
  </main>
`;

test('extractParticipantsFromOfficialHtml reads the official granjeros section only', () => {
  const rows = extractParticipantsFromOfficialHtml(OFFICIAL_SECTION_HTML, {
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
  });

  assert.deepEqual(rows.map(row => row.name), [
    'Carlos Trejo',
    'Ivonne Montero',
    'Kunno',
    'Mono Osuna',
    'Pascal Nadaud',
    'Pimpinela Escarlata',
  ]);
  assert.ok(rows.every(row => row.url.startsWith('https://www.tvazteca.com/')));
});

const BASE = 'https://www.tvazteca.com/aztecauno/la-granja-vip/';

function article(title, publishedAt, body) {
  return `<meta property="article:published_time" content="${publishedAt}"><article><h1>${title}</h1><div class="articleBody">${body}</div></article>`;
}

function fixtureFetch(articles, extra = '') {
  const listing = OFFICIAL_SECTION_HTML + extra + articles.map(item => `<a href="${item.path}">${item.title}</a>`).join('');
  return async input => {
    const url = new URL(input);
    const found = articles.find(item => url.pathname === new URL(item.path, BASE).pathname);
    return { ok: true, status: 200, text: async () => found ? article(found.title, found.publishedAt, found.body) : listing };
  };
}

test('dated article parsing excludes Corral VIP and requires publication metadata', () => {
  assert.equal(parseOfficialGranjaArticle(article('El Corral VIP: nominados', '2026-10-14T21:00:00Z', '<p>Lista</p>'), BASE), null);
  assert.equal(parseOfficialGranjaArticle('<article><h1>Lista de nominados</h1></article>', BASE), null);
  assert.equal(parseOfficialGranjaArticle(article('Lista de nominados', '2026-10-14T21:00:00', '<p>Lista</p>'), BASE).publishedAt, '2026-10-14T21:00:00.000Z');
});

test('stale and unrelated nominees never generate the next weeks elimination', async () => {
  const fetchImpl = fixtureFetch([
    { path: 'nominados-pasados/', title: 'OFICIAL: Lista de nominados', publishedAt: '2026-10-08T23:00:00Z', body: '<p>Actualmente los nominados son: Carlos Trejo, Kunno e Ivonne Montero.</p>' },
    { path: 'corral-nominados/', title: 'El Corral VIP: nominados', publishedAt: '2026-10-14T23:00:00Z', body: '<p>Actualmente los nominados son: Carlos Trejo, Kunno e Ivonne Montero.</p>' },
  ]);
  const now = new Date('2026-10-15T18:00:00Z');
  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now });
  assert.deepEqual(snapshot.nominated, []);
  assert.equal(buildGranjaVipWeeklyMarketSpec({ snapshot, now }), null);
});

test('capataz generates only with the dated finalists for the upcoming Monday', async () => {
  const fetchImpl = fixtureFetch([{ path: 'finalistas-capataz/', title: 'Finalistas que lucharán por ser Capataz', publishedAt: '2026-10-12T21:45:00Z',
    body: '<p>La final reunirá a Bebeshita, Pablo Montero, Julio Camejo e Ivonne Montero.</p>' }]);
  const now = new Date('2026-10-12T22:00:00Z');
  const snapshot = await readGranjaVipOfficialSnapshot({ fetchImpl, now });
  const spec = buildGranjaVipWeeklyMarketSpec({ snapshot, now, kind: 'capataz' });
  assert.equal(spec.source_event_id, 'granja-vip-capataz:2026-10-12');
  assert.equal(spec.end_time, '2026-10-13T02:25:00.000Z');
  assert.equal(spec.resolver_config.kind, 'granja-vip-capataz');
  assert.deepEqual(new Set(spec.outcomes), new Set(['Daniela Alexis "Bebeshita"', 'Pablo Montero', 'Julio Camejo', 'Ivonne Montero']));
  const later = new Date('2026-10-15T18:00:00Z');
  const stale = await readGranjaVipOfficialSnapshot({ fetchImpl, now: later });
  assert.equal(buildGranjaVipWeeklyMarketSpec({ snapshot: stale, now: later, kind: 'capataz' }), null);
  assert.equal(nextGranjaVipCapatazClose(new Date('2026-10-13T02:25:00Z')).toISOString(), '2026-10-20T02:25:00.000Z');
});

test('official elimination can resolve even after todays roster marks the winner eliminated', async () => {
  const nominees = { path: 'nominados-actuales/', title: 'Lista oficial de nominados', publishedAt: '2026-10-14T23:00:00Z', body: '<p>Actualmente los nominados son: Carlos Trejo e Ivonne Montero.</p>' };
  const result = { path: 'eliminado-gala/', title: 'Carlos Trejo es el eliminado de La Granja VIP', publishedAt: '2026-10-19T04:00:00Z', body: '<p>Carlos Trejo fue eliminado en la gala del domingo 18 de octubre.</p>' };
  const fetchImpl = fixtureFetch([nominees, result], '<h3>Eliminados: La Granja VIP Segunda Temporada</h3><p>Carlos Trejo</p><h3>Conductores</h3>');
  const cfg = { kind: 'granja-vip-elimination', weekKey: '2026-10-18', resolveAt: '2026-10-19T01:55:00Z' };
  const options = { fetchImpl, now: new Date('2026-10-19T05:00:00Z') };
  assert.equal((await readGranjaVipOfficialResult(cfg, ['Carlos Trejo', 'Ivonne Montero'], options)).winningIdx, 0);
  await assert.rejects(() => readGranjaVipOfficialResult(cfg, ['Kunno', 'Ivonne Montero'], options), error => error.benign && error.manualReview);
});

test('official capataz uses that contests result, not old titles or speculative headlines', async () => {
  const finalists = { path: 'finalistas-capataz/', title: 'Finalistas que lucharán por ser Capataz', publishedAt: '2026-10-12T21:45:00Z',
    body: '<p>La final reunirá a Pablo Montero, Julio Camejo e Ivonne Montero.</p>' };
  const result = { path: 'pablo-gana-capataz/', title: 'Pablo Montero se convierte en el nuevo Capataz', publishedAt: '2026-10-13T04:00:00Z', body: '<p>Pablo Montero ganó la prueba de Capataz.</p>' };
  const cfg = { kind: 'granja-vip-capataz', weekKey: '2026-10-12', resolveAt: '2026-10-13T02:25:00Z' };
  const now = new Date('2026-10-13T05:00:00Z');
  const outcomes = ['Ivonne Montero', 'Julio Camejo', 'Pablo Montero'];
  assert.equal((await readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists, result]), now })).winningIdx, 2);
  for (const invalid of [{ ...result, publishedAt: '2026-10-06T04:00:00Z' }, { ...result, title: '¿Pablo Montero será el nuevo Capataz?' }]) {
    await assert.rejects(() => readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists, invalid]), now }), /missing_or_ambiguous/);
  }
  const conflicting = { ...result, path: 'julio-gana-capataz/', title: 'Julio Camejo se convierte en el nuevo Capataz' };
  await assert.rejects(() => readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists, result, conflicting]), now }), error => error.benign && error.manualReview);
  await assert.rejects(() => readGranjaVipOfficialResult(cfg, outcomes, { fetchImpl: fixtureFetch([finalists]), now: new Date('2026-10-15T05:00:00Z') }), error => error.benign && error.manualReview);
});

test('readGranjaVipOfficialSnapshot ignores undated nomination headlines', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      ${OFFICIAL_SECTION_HTML}
      <a href="/aztecauno/la-granja-vip/nominados">
        Carlos Trejo, Ivonne Montero y Kunno son los nominados de La Granja VIP
      </a>
    `,
  });

  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl,
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    now: new Date('2026-09-09T18:00:00Z'),
  });

  assert.equal(snapshot.ok, true);
  assert.deepEqual(snapshot.nominated, []);
  assert.equal(snapshot.eliminated.length, 0);
});

test('readGranjaVipOfficialSnapshot follows official nominee article links', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes('/nominados-finales/')
      ? `
        <meta property="article:published_time" content="2026-10-08T00:00:00Z">
        <article>
          <h1>OFICIAL: LISTA completa de NOMINADOS en la quinta semana</h1>
          <p>Aunque la Tabla final cambiará luego del viernes de Traición,
          actualmente los nominados son: Pimpinela Escarlata Ivonne Montero
          Julio Camejo Pascal Nadaud Natalia Alcocer</p>
          <p>Tags relacionados</p>
        </article>
      `
      : `
        ${OFFICIAL_SECTION_HTML.replace('<h3>Conductores', '<a href="/aztecauno/la-granja-vip/natalia-alcocer">Natalia Alcocer</a><a href="/aztecauno/la-granja-vip/julio-camejo">Julio Camejo</a><h3>Conductores')}
        <a href="/aztecauno/la-granja-vip/nominados-finales/">
          OFICIAL: LISTA completa de NOMINADOS en la quinta semana de La Granja VIP
        </a>
      `,
  });

  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl,
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    now: new Date('2026-10-08T18:00:00Z'),
  });

  assert.deepEqual(snapshot.nominated.map(row => row.name), [
    'Ivonne Montero',
    'Pascal Nadaud',
    'Pimpinela Escarlata',
    'Natalia Alcocer',
    'Julio Camejo',
  ]);
  assert.equal(snapshot.nomineeEvidence[0].url, 'https://www.tvazteca.com/aztecauno/la-granja-vip/nominados-finales/');
});

test('readGranjaVipOfficialSnapshot extracts final list after earlier nomination changes', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes('/tabla-nominados/')
      ? `
        <meta property="article:published_time" content="2026-10-08T00:00:00Z">
        <article>
          <h1>El huevo dorado cambió la Tabla de Nominados</h1>
          <p>Mónica Escobedo recibió votos, pero Mono Osuna la sacó de la tabla.</p>
          <p>Natalia Alcocer puso a Pascal Nadaud automáticamente.</p>
          <p>Así quedó la Tabla de Nominados este miércoles. Actualmente los nominados son:
          Pimpinela Escarlata Ivonne Montero Julio Camejo Pascal Nadaud Natalia Alcocer</p>
          <p>Tags relacionados Mónica Escobedo Mono Osuna</p>
        </article>
      `
      : `
        ${OFFICIAL_SECTION_HTML.replace('<h3>Conductores', '<a href="/aztecauno/la-granja-vip/natalia-alcocer">Natalia Alcocer</a><a href="/aztecauno/la-granja-vip/julio-camejo">Julio Camejo</a><h3>Conductores')}
        <a href="/aztecauno/la-granja-vip/tabla-nominados/">
          El huevo dorado benefició a dos Granjeros y cambió la Tabla de Nominados
        </a>
      `,
  });

  const snapshot = await readGranjaVipOfficialSnapshot({
    fetchImpl,
    baseUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    now: new Date('2026-10-08T18:00:00Z'),
  });

  assert.deepEqual(snapshot.nominated.map(row => row.name), [
    'Ivonne Montero',
    'Pascal Nadaud',
    'Pimpinela Escarlata',
    'Natalia Alcocer',
    'Julio Camejo',
  ]);
  assert.ok(!snapshot.nominated.some(row => row.name === 'Mónica Escobedo'));
  assert.ok(!snapshot.nominated.some(row => row.name === 'Mono Osuna'));
});

test('nextGranjaVipSundayClose defaults to before the Sunday elimination gala', () => {
  const close = nextGranjaVipSundayClose(new Date('2026-09-09T18:00:00Z'));
  assert.equal(close.toISOString(), '2026-09-14T01:55:00.000Z');
});

test('buildGranjaVipWeeklyMarketSpec creates an automatic elimination draft with dated evidence', () => {
  const now = new Date('2026-09-09T18:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    observedAt: now.toISOString(),
    parsedCount: 3,
    total: 6,
    nomineeEvidence: [{ title: 'Lista de nominados', url: 'https://www.tvazteca.com/aztecauno/la-granja-vip/nominados/', publishedAt: now.toISOString() }],
    rows: [
      { name: 'Carlos Trejo', slug: 'carlos-trejo', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/carlos' },
      { name: 'Ivonne Montero', slug: 'ivonne-montero', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/ivonne' },
      { name: 'Kunno', slug: 'kunno', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/kunno' },
    ],
    nominated: [
      { name: 'Carlos Trejo', slug: 'carlos-trejo', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/carlos' },
      { name: 'Ivonne Montero', slug: 'ivonne-montero', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/ivonne' },
      { name: 'Kunno', slug: 'kunno', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/kunno' },
    ],
  };

  const spec = buildGranjaVipWeeklyMarketSpec({ snapshot, now });

  assert.equal(spec.source, 'granja-vip-official');
  assert.equal(spec.source_event_id, 'granja-vip-elimination:2026-09-13');
  assert.equal(spec.resolver_type, 'api_chart');
  assert.equal(spec.amm_mode, 'parallel');
  assert.deepEqual(spec.outcomes, ['Carlos Trejo', 'Ivonne Montero', 'Kunno']);
  assert.equal(spec.resolver_config.source, 'official-result');
  assert.equal(spec.source_data.kind, 'granja_vip_week');
  assert.deepEqual(spec.geo_tags, ['mexico']);
  assert.deepEqual(spec.topic_tags, ['tv', 'farandula']);
});
