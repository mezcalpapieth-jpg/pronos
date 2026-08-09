import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANANERA_TRANSCRIPT_SOURCE,
  buildMananeraSearchUrl,
  countPhraseOccurrences,
  readMananeraPhraseResult,
} from './mananera.js';

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function transcriptHtml({ dateText = '10 de agosto de 2026', mentions = 'seguridad y seguridad' } = {}) {
  const filler = ' La conferencia matutina contiene contexto oficial de prueba.'.repeat(20);
  return `
    <html>
      <head>
        <title>Versión estenográfica de la conferencia matutina del pueblo, ${dateText}</title>
      </head>
      <body>
        <article>
          <p>${dateText}</p>
          <p>${mentions}</p>
          <p>${filler}</p>
        </article>
      </body>
    </html>
  `;
}

test('counts transcript phrases accent-insensitively', () => {
  assert.equal(
    countPhraseOccurrences('Seguridad pública; seguridad, y más seguridad.', 'seguridad'),
    3,
  );
  assert.equal(countPhraseOccurrences('inflacion e inflación', 'inflación'), 2);
  assert.equal(countPhraseOccurrences('Estados Unidos y estados unidos.', 'Estados Unidos'), 2);
  assert.equal(
    countPhraseOccurrences('Presidenta de los Estados Unidos Mexicanos. Estados Unidos pidió una reunión.', 'Estados Unidos'),
    1,
  );
});

test('reads official transcript search result and resolves yes when count reaches threshold', async () => {
  const articleUrl = 'https://www.gob.mx/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-10-de-agosto-de-2026';
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(String(url));
    if (String(url).startsWith('https://www.gob.mx/busqueda')) {
      return htmlResponse(`<a href="/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-10-de-agosto-de-2026">Transcripción</a>`);
    }
    assert.equal(String(url), articleUrl);
    return htmlResponse(transcriptHtml());
  };

  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmd: '2026-08-10',
    phrase: 'seguridad',
    op: 'gte',
    threshold: 2,
    yesOutcome: 0,
  }, { fetchImpl });

  assert.equal(result.ready, true);
  assert.equal(result.yes, true);
  assert.equal(result.outcomeIndex, 0);
  assert.equal(result.count, 2);
  assert.equal(result.transcriptUrl, articleUrl);
  assert.deepEqual(seen, [buildMananeraSearchUrl('2026-08-10'), articleUrl]);
});

test('resolves no when transcript exists but phrase count misses threshold', async () => {
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://www.gob.mx/busqueda')) {
      return htmlResponse('<a href="/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-10-de-agosto-de-2026">Transcripción</a>');
    }
    return htmlResponse(transcriptHtml({ mentions: 'seguridad pública solamente una vez' }));
  };

  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmd: '2026-08-10',
    phrase: 'seguridad',
    op: 'gte',
    threshold: 2,
    yesOutcome: 0,
  }, { fetchImpl });

  assert.equal(result.ready, true);
  assert.equal(result.yes, false);
  assert.equal(result.outcomeIndex, 1);
  assert.equal(result.count, 1);
});

test('defers when the official transcript for that date is not found', async () => {
  const fetchImpl = async () => htmlResponse('<a href="/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-09-de-agosto-de-2026">Otro día</a>');

  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmd: '2026-08-10',
    phrase: 'seguridad',
    op: 'gte',
    threshold: 1,
    yesOutcome: 0,
  }, { fetchImpl });

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'official_transcript_not_found');
  assert.equal(result.searchUrl, buildMananeraSearchUrl('2026-08-10'));
});
