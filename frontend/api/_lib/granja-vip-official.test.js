import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildGranjaVipWeeklyMarketSpec,
  extractParticipantsFromOfficialHtml,
  nextGranjaVipSundayClose,
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

test('readGranjaVipOfficialSnapshot marks nominees from scoped official links', async () => {
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
  assert.deepEqual(snapshot.nominated.map(row => row.name), ['Carlos Trejo', 'Ivonne Montero', 'Kunno']);
  assert.equal(snapshot.eliminated.length, 0);
});

test('readGranjaVipOfficialSnapshot follows official nominee article links', async () => {
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes('/nominados-finales/')
      ? `
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

test('buildGranjaVipWeeklyMarketSpec creates a manual-review elimination draft', () => {
  const now = new Date('2026-09-09T18:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.tvazteca.com/aztecauno/la-granja-vip/',
    observedAt: now.toISOString(),
    parsedCount: 3,
    total: 6,
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
  assert.equal(spec.resolver_type, 'manual_review');
  assert.equal(spec.amm_mode, 'parallel');
  assert.deepEqual(spec.outcomes, ['Carlos Trejo', 'Ivonne Montero', 'Kunno']);
  assert.equal(spec.resolver_config.source, 'granja-vip-official');
  assert.equal(spec.source_data.kind, 'granja_vip_week');
  assert.deepEqual(spec.geo_tags, ['mexico']);
  assert.deepEqual(spec.topic_tags, ['tv', 'farandula']);
});
