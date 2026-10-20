import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMananeraArchiveUrl,
  buildMananeraDirectTranscriptUrl,
} from './mananera.js';
import {
  buildMananeraParsedRecord,
  ingestMananeraForDate,
  readStoredMananeraTranscript,
  persistMananeraTranscript,
  parseMananeraTurns,
  shouldRunMananeraAttempt,
} from './mananera-ingest.js';

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function notFoundResponse() {
  return {
    ok: false,
    status: 404,
    text: async () => '',
  };
}

function officialHtml({ dateText = '11 de agosto de 2026' } = {}) {
  const filler = ' La versión estenográfica contiene contexto oficial suficiente para pruebas.'.repeat(35);
  return `
    <html>
      <head>
        <title>Versión estenográfica conferencia de prensa de la presidenta Claudia Sheinbaum Pardo del ${dateText}</title>
        <script>window.noise = true;</script>
      </head>
      <body>
        <h1>Encabezado</h1>
        <p>${dateText}</p>
        <p>Texto previo que no debe quedar como inicio.</p>
        <p>PRESIDENTA DE MÉXICO, CLAUDIA SHEINBAUM PARDO: Buenos días. Hoy hablamos de seguridad y economía.</p>
        <p>PREGUNTA: Presidenta, ¿qué sigue?</p>
        <p>SECRETARIO DE SEGURIDAD Y PROTECCIÓN CIUDADANA, OMAR GARCÍA HARFUCH: Informamos avances.${filler}</p>
      <p>—000—</p>
      </body>
    </html>
  `;
}

function createFakeDb() {
  const rows = new Map();
  const calls = [];
  return {
    calls,
    rows,
    async query(text, params = []) {
      calls.push({ text, params });
      if (/SELECT date_ymd::text AS date_ymd[\s\S]+WHERE date_ymd = \$1::date/.test(text)) {
        return rows.has(params[0]) ? [rows.get(params[0])] : [];
      }
      if (/INSERT INTO points_mananera_transcripts/.test(text)) {
        const row = {
          date_ymd: params[0],
          source: params[1],
          url: params[2],
          fetched_at: params[3],
          raw_html_sha256: 'sha-test',
          raw_html_bytes: params[6],
          transcript_text: params[7],
          characters: params[8],
          words: params[9],
          n_turnos: params[10],
          speakers: JSON.parse(params[11]),
          turns: JSON.parse(params[12]),
          parse_version: params[13],
          complete: true,
          created_at: '2026-08-11T18:00:00.000Z',
          updated_at: '2026-08-11T18:00:00.000Z',
        };
        rows.set(params[0], row);
        return [row];
      }
      if (/WHERE date_ymd = ANY\(\$1::date\[\]\)/.test(text)) {
        return (params[0] || []).filter(day => rows.has(day)).map(day => rows.get(day));
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

test('parses Mañanera transcript turns by speaker', () => {
  const record = buildMananeraParsedRecord({
    dateYmd: '2026-08-11',
    url: buildMananeraDirectTranscriptUrl('2026-08-11'),
    fetchedAt: '2026-08-11T18:00:00.000Z',
    html: officialHtml(),
  });

  assert.equal(record.nTurnos, 3);
  assert.deepEqual(record.speakers, [
    'PRESIDENTA DE MÉXICO, CLAUDIA SHEINBAUM PARDO',
    'PREGUNTA',
    'SECRETARIO DE SEGURIDAD Y PROTECCIÓN CIUDADANA, OMAR GARCÍA HARFUCH',
  ]);
  assert.equal(record.turns[0].orden, 1);
  assert.match(record.turns[0].texto, /Buenos días/);
  assert.ok(!record.transcriptText.startsWith('Encabezado'));
});

test('low-level speaker parser ignores text before the first label', () => {
  const turns = parseMananeraTurns(`
    Intro
    PRESIDENTA DE MÉXICO, CLAUDIA SHEINBAUM PARDO: Uno.
    INTERVENCIÓN: Dos.
  `);
  assert.equal(turns.length, 2);
  assert.equal(turns[1].hablante, 'INTERVENCIÓN');
});

test('ingests direct zero-padded gob.mx slug and second run performs zero network requests', async () => {
  const db = createFakeDb();
  const dateYmd = '2026-08-11';
  const directUrl = buildMananeraDirectTranscriptUrl(dateYmd);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    assert.equal(String(url), directUrl);
    return htmlResponse(officialHtml());
  };

  const first = await ingestMananeraForDate(db, {
    dateYmd,
    fetchImpl,
    now: new Date('2026-08-11T18:00:00.000Z'),
  });
  assert.equal(first.ready, true);
  assert.equal(first.skipped, false);
  assert.equal(first.networkRequests, 1);
  assert.equal(first.transcript.nTurnos, 3);
  assert.deepEqual(seen, [directUrl]);

  const second = await ingestMananeraForDate(db, {
    dateYmd,
    fetchImpl: async () => {
      throw new Error('second run should not fetch');
    },
  });
  assert.equal(second.ready, true);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already_ingested');
  assert.equal(second.networkRequests, 0);
});

test('falls back from direct 404 to gob.mx archive article discovery', async () => {
  const db = createFakeDb();
  const dateYmd = '2026-08-06';
  const directUrl = buildMananeraDirectTranscriptUrl(dateYmd);
  const articleUrl = 'https://www.gob.mx/presidencia/articulos/version-estenografica-conferencia-de-prensa-del-06-de-agosto-de-2026';
  const archiveUrl = buildMananeraArchiveUrl();
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href !== articleUrl && href !== archiveUrl) return notFoundResponse();
    if (href === archiveUrl) {
      return htmlResponse('<a href="/presidencia/articulos/version-estenografica-conferencia-de-prensa-del-06-de-agosto-de-2026">Transcripción</a>');
    }
    if (href === articleUrl) return htmlResponse(officialHtml({ dateText: '06 de agosto de 2026' }));
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await ingestMananeraForDate(db, { dateYmd, fetchImpl });
  assert.equal(result.ready, true);
  assert.equal(result.transcript.url, articleUrl);
  assert.equal(seen[0], directUrl);
  assert.ok(seen.includes(archiveUrl));
  assert.equal(seen.at(-1), articleUrl);
});

test('cron attempt gate is keyed to Mexico City weekday attempt hours', () => {
  assert.equal(shouldRunMananeraAttempt(new Date('2026-08-11T18:00:00.000Z')), true);
  assert.equal(shouldRunMananeraAttempt(new Date('2026-08-11T19:00:00.000Z')), false);
  assert.equal(shouldRunMananeraAttempt(new Date('2026-08-15T18:00:00.000Z')), false);
});

test('rejects incomplete records before writing a complete cache row', async () => {
  for (const end of ['', '**_(CONTINÚA…)_**']) {
    assert.throws(() => buildMananeraParsedRecord({
      dateYmd: '2026-08-11', html: officialHtml().replace('—000—', end),
    }), /official_transcript_incomplete/);
  }
  const db = createFakeDb();
  await assert.rejects(persistMananeraTranscript(db, {
    transcriptText: 'PRESIDENTA DE MÉXICO: Buenos días.\n(CONTINÚA…)'
  }), /official_transcript_incomplete/);
  assert.equal(db.calls.length, 0);
});

test('refreshes legacy complete cache rows that actually end in CONTINÚA', async () => {
  const db = createFakeDb();
  db.rows.set('2026-08-11', { date_ymd: '2026-08-11', complete: true,
    transcript_text: 'PRESIDENTA DE MÉXICO: Buenos días.\n**_(CONTINÚA…)_**',
    turns: [], speakers: [], n_turnos: 1, parse_version: 1 });
  assert.equal(await readStoredMananeraTranscript(db, '2026-08-11'), null);
  const result = await ingestMananeraForDate(db, { dateYmd: '2026-08-11',
    fetchImpl: async () => htmlResponse(officialHtml()) });
  assert.equal(result.ready, true);
  assert.equal(result.skipped, false);
  assert.equal(result.transcript.parseVersion, 2);
  assert.equal(result.transcript.nTurnos, 3);
});

test('reparses Markdown speaker boundaries instead of trusting legacy cached turns', async () => {
  const db = createFakeDb();
  db.rows.set('2026-08-11', { date_ymd: '2026-08-11', complete: true,
    transcript_text: '**PRESIDENTA DE MÉXICO:** Buenos días.\n**PREGUNTA: IMSS?**\n**—000—**',
    turns: [{ hablante: 'PRESIDENTA DE MÉXICO', texto: 'Buenos días. IMSS?' }],
    speakers: ['PRESIDENTA DE MÉXICO'], n_turnos: 1, parse_version: 1 });
  const result = await readStoredMananeraTranscript(db, '2026-08-11');
  assert.equal(result.turns.length, 2);
  assert.equal(result.turns[1].hablante, 'PREGUNTA');
  assert.equal(result.turns[0].texto, 'Buenos días.');
});
