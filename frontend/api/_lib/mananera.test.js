import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANANERA_TRANSCRIPT_SOURCE,
  MANANERA_YOUTUBE_CAPTIONS_SOURCE,
  buildMananeraSearchUrl,
  buildMananeraYouTubeSearchUrl,
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

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
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

test('falls back to official YouTube captions when gob.mx transcript is delayed', async () => {
  const videoId = 'abc123DEF45';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Texto de caption oficial simulado. '.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.startsWith('https://www.gob.mx/busqueda')) {
      return htmlResponse('<a href="/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-09-de-agosto-de-2026">Otro día</a>');
    }
    if (href === 'https://www.gob.mx/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-09-de-agosto-de-2026') {
      return htmlResponse(transcriptHtml({ dateText: '9 de agosto de 2026', mentions: 'otro día' }));
    }
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse(`
        <feed>
          <entry>
            <yt:videoId>${videoId}</yt:videoId>
            <title>Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum</title>
            <author><name>Claudia Sheinbaum Pardo</name></author>
          </entry>
        </feed>
      `);
    }
    if (href.startsWith('https://www.googleapis.com/youtube/v3/search')) {
      return jsonResponse({
        items: [{
          id: { videoId },
          snippet: {
            title: 'Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum',
            channelTitle: 'Claudia Sheinbaum Pardo',
          },
        }],
      });
    }
    if (href === `https://www.youtube.com/watch?v=${videoId}`) {
      return htmlResponse(`
        <html><body><script>
          var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
            {"baseUrl":${JSON.stringify(captionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
          ]}}};
        </script></body></html>
      `);
    }
    if (href.startsWith(captionBaseUrl)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [
            { tStartMs: 121000, segs: [{ utf8: 'La presidenta habló de seguridad nacional ' }] },
            { tStartMs: 185000, segs: [{ utf8: 'y seguridad pública. ' }] },
            { tStartMs: 246000, segs: [{ utf8: 'También revisamos seguridad en carreteras. ' }] },
            { tStartMs: 307000, segs: [{ utf8: 'La seguridad sigue siendo prioridad. ' }] },
            { tStartMs: 368000, segs: [{ utf8: `La mesa de seguridad informó avances. ${captionFiller}` }] },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmd: '2026-08-10',
    phrase: 'seguridad',
    op: 'gte',
    threshold: 5,
    yesOutcome: 0,
  }, { fetchImpl, youtubeApiKey: null });

  assert.equal(result.ready, true);
  assert.equal(result.yes, true);
  assert.equal(result.outcomeIndex, 0);
  assert.equal(result.count, 5);
  assert.equal(result.transcriptSource, MANANERA_YOUTUBE_CAPTIONS_SOURCE);
  assert.equal(result.transcriptUrl, `https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(result.videoId, videoId);
  assert.equal(result.channelTitle, 'Claudia Sheinbaum Pardo');
  assert.equal(result.captionKind, 'asr');
  assert.equal(result.firstMatchSeconds, 121);
  assert.equal(result.firstMatchTimestamp, '2:01');
  assert.equal(result.firstMatchUrl, `https://www.youtube.com/watch?v=${videoId}&t=121s`);
  assert.deepEqual(result.requiredMatchTimestamps.map(t => t.label), ['2:01', '3:05', '4:06', '5:07', '6:08']);
  assert.deepEqual(result.matchTimestamps.map(t => t.label), ['2:01', '3:05', '4:06', '5:07', '6:08']);
  assert.ok(seen.some(url => url.startsWith('https://www.youtube.com/feeds/videos.xml')));
  assert.ok(!seen.some(url => url.startsWith('https://www.googleapis.com/youtube/v3/search')));
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
  }, { fetchImpl, youtubeApiKey: null });

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'official_transcript_not_found');
  assert.equal(result.searchUrl, buildMananeraSearchUrl('2026-08-10'));
  assert.equal(result.fallbackReason, 'official_youtube_video_not_found');
  assert.equal(result.youtubeSearchUrl, buildMananeraYouTubeSearchUrl('2026-08-10'));
});
