import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANANERA_TRANSCRIPT_SOURCE,
  MANANERA_YOUTUBE_CAPTIONS_SOURCE,
  buildMananeraDirectTranscriptUrl,
  buildMananeraDirectTranscriptUrlVariants,
  buildMananeraSearchUrl,
  buildMananeraYouTubeSearchUrl,
  countPhraseOccurrences,
  findMananeraTranscript,
  findMananeraYouTubeTranscript,
  readMananeraPhraseResult,
} from './mananera.js';

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function statusResponse(status) {
  return {
    ok: false,
    status,
    text: async () => '',
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

test('reads official transcript direct slug and resolves yes when count reaches threshold', async () => {
  const articleUrl = buildMananeraDirectTranscriptUrl('2026-08-10');
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
    youtubeFallback: false,
  }, { fetchImpl });

  assert.equal(result.ready, true);
  assert.equal(result.yes, true);
  assert.equal(result.outcomeIndex, 0);
  assert.equal(result.count, 2);
  assert.equal(result.transcriptUrl, articleUrl);
  assert.deepEqual(seen, [articleUrl]);
});

test('uses browser-like headers when fetching gob.mx transcript pages', async () => {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url: String(url), headers: options.headers || {} });
    return htmlResponse(transcriptHtml({
      dateText: '17 de agosto de 2026',
      mentions: 'huachicol y seguridad',
    }));
  };

  const result = await findMananeraTranscript({
    dateYmd: '2026-08-17',
    fetchImpl,
  });

  assert.equal(result.ready, true);
  assert.equal(result.url, buildMananeraDirectTranscriptUrl('2026-08-17'));
  assert.match(seen[0].headers['user-agent'], /Mozilla\/5\.0/);
  assert.match(seen[0].headers['accept-language'], /es-MX/);
  assert.equal(seen[0].headers.accept, 'text/html,application/xhtml+xml');
});

test('falls back to text-reader extraction for the same official gob.mx page', async () => {
  const articleUrl = buildMananeraDirectTranscriptUrl('2026-08-17');
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    seen.push({ href, headers: options.headers || {} });
    if (href.startsWith('https://r.jina.ai/http://')) {
      assert.equal(options.headers?.accept, 'text/plain,*/*');
      assert.equal(options.headers?.['user-agent'], 'Mozilla/5.0');
      return htmlResponse(`
        Title: Versión estenográfica. Conferencia de prensa de la presidenta Claudia Sheinbaum Pardo del 17 de agosto de 2026
        URL Source: ${articleUrl}

        17 de agosto de 2026.
        La presidenta mencionó huachicol. ${'Contexto oficial de prueba. '.repeat(40)}
      `);
    }
    if (buildMananeraDirectTranscriptUrlVariants('2026-08-17').includes(href)) {
      return statusResponse(403);
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraTranscript({
    dateYmd: '2026-08-17',
    fetchImpl,
  });

  assert.equal(result.ready, true);
  assert.equal(result.url, articleUrl);
  assert.ok(seen.some(item => item.href.startsWith('https://r.jina.ai/http://')));
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
    youtubeFallback: false,
  }, { fetchImpl });

  assert.equal(result.ready, true);
  assert.equal(result.yes, false);
  assert.equal(result.outcomeIndex, 1);
  assert.equal(result.count, 1);
});

test('resolves from an ingested stored transcript without fetching gob.mx again', async () => {
  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmd: '2026-08-10',
    phrase: 'seguridad',
    op: 'gte',
    threshold: 2,
    yesOutcome: 0,
    youtubeFallback: false,
  }, {
    storedTranscript: {
      dateYmd: '2026-08-10',
      source: MANANERA_TRANSCRIPT_SOURCE,
      url: buildMananeraDirectTranscriptUrl('2026-08-10'),
      transcriptText: 'PRESIDENTA DE MÉXICO: seguridad pública y seguridad nacional.',
    },
    fetchImpl: async () => {
      throw new Error('stored transcript should avoid network fetch');
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.count, 2);
  assert.equal(result.yes, true);
  assert.deepEqual(result.requiredMatchTimestamps, []);
  assert.equal(result.requiredMatchPositions.length, 2);
  assert.equal(result.requiredMatchPositions[0].charIndex, 22);
  assert.ok(result.requiredMatchPositions[0].totalChars > 50);
  assert.equal(result.timestampEvidenceUnavailableReason, 'timed_caption_segments_not_found');
});

test('falls back to official YouTube captions when gob.mx transcript is delayed or blocked', async () => {
  const videoId = 'abc123DEF45';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Texto de caption oficial simulado. '.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (buildMananeraDirectTranscriptUrlVariants('2026-08-10').includes(href)
      || href.startsWith('https://r.jina.ai/http://')) {
      return statusResponse(403);
    }
    if (href === 'https://www.gob.mx/presidencia/archivo/articulos') {
      return htmlResponse('<html><body>Sin estenográfica del día</body></html>');
    }
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
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse('<html><body>Sin streams extra</body></html>');
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

test('prefers timed YouTube captions for evidence when official transcript has no timestamps', async () => {
  const videoId = 'timedEv42AA';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Segmento oficial con contexto suficiente. '.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (buildMananeraDirectTranscriptUrlVariants('2026-08-10').includes(href)) {
      return htmlResponse(transcriptHtml({
        dateText: '10 de agosto de 2026',
        mentions: 'seguridad seguridad seguridad',
      }));
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
    if (href === `https://www.youtube.com/watch?v=${videoId}`) {
      return htmlResponse(`
        <html><body><script>
          var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
            {"baseUrl":${JSON.stringify(captionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español"}}
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
            { tStartMs: 61000, segs: [{ utf8: 'La seguridad fue mencionada. ' }] },
            { tStartMs: 122000, segs: [{ utf8: 'Seguridad pública y coordinación. ' }] },
            { tStartMs: 183000, segs: [{ utf8: `Otra vez seguridad. ${captionFiller}` }] },
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
    threshold: 2,
    yesOutcome: 0,
  }, { fetchImpl, youtubeApiKey: null });

  assert.equal(result.ready, true);
  assert.equal(result.transcriptSource, MANANERA_YOUTUBE_CAPTIONS_SOURCE);
  assert.deepEqual(result.requiredMatchTimestamps.map(t => t.label), ['1:01', '2:02']);
  assert.equal(result.requiredMatchPositions.length, 2);
  assert.ok(seen.includes(buildMananeraDirectTranscriptUrl('2026-08-10')));
  assert.ok(seen.some(url => url.startsWith('https://www.youtube.com/feeds/videos.xml')));
});

test('tries the next same-day YouTube video when the first captions are empty', async () => {
  const firstVideoId = 'aaa111BBB22';
  const secondVideoId = 'ccc333DDD44';
  const firstCaptionBaseUrl = `https://www.youtube.com/api/timedtext?v=${firstVideoId}&lang=es`;
  const secondCaptionBaseUrl = `https://www.youtube.com/api/timedtext?v=${secondVideoId}&lang=es`;
  const captionFiller = 'Transcripción oficial simulada. '.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse(`
        <feed>
          <entry>
            <yt:videoId>${firstVideoId}</yt:videoId>
            <title>Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum</title>
            <author><name>Claudia Sheinbaum Pardo</name></author>
          </entry>
          <entry>
            <yt:videoId>${secondVideoId}</yt:videoId>
            <title>Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum</title>
            <author><name>Claudia Sheinbaum Pardo</name></author>
          </entry>
        </feed>
      `);
    }
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse('<html><body>Sin streams extra</body></html>');
    }
    if (href === `https://www.youtube.com/watch?v=${firstVideoId}`) {
      return htmlResponse(`
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(firstCaptionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href === `https://www.youtube.com/watch?v=${secondVideoId}`) {
      return htmlResponse(`
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(secondCaptionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href.startsWith(firstCaptionBaseUrl)) {
      return { ok: true, status: 200, text: async () => '' };
    }
    if (href.startsWith(secondCaptionBaseUrl)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [
            { tStartMs: 42000, segs: [{ utf8: 'Hoy revisamos inflación y economía. ' }] },
            { tStartMs: 84000, segs: [{ utf8: captionFiller }] },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraYouTubeTranscript({
    dateYmd: '2026-08-10',
    fetchImpl,
    youtubeApiKey: null,
  });

  assert.equal(result.ready, true);
  assert.equal(result.videoId, secondVideoId);
  assert.equal(result.captionAttempts.length, 1);
  assert.equal(result.captionAttempts[0].videoId, firstVideoId);
  assert.equal(result.captionAttempts[0].reason, 'youtube_captions_empty');
  assert.ok(seen.includes(`https://www.youtube.com/watch?v=${firstVideoId}`));
  assert.ok(seen.includes(`https://www.youtube.com/watch?v=${secondVideoId}`));
});

test('reports empty YouTube captions when all same-day videos are unusable', async () => {
  const firstVideoId = 'emp111AAA22';
  const secondVideoId = 'not111BBB22';
  const firstCaptionBaseUrl = `https://www.youtube.com/api/timedtext?v=${firstVideoId}&lang=es`;
  const fetchImpl = async (url) => {
    const href = String(url);
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse(`
        <feed>
          <entry>
            <yt:videoId>${firstVideoId}</yt:videoId>
            <title>Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum</title>
            <author><name>Claudia Sheinbaum Pardo</name></author>
          </entry>
          <entry>
            <yt:videoId>${secondVideoId}</yt:videoId>
            <title>Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum</title>
            <author><name>Claudia Sheinbaum Pardo</name></author>
          </entry>
        </feed>
      `);
    }
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse('<html><body>Sin streams extra</body></html>');
    }
    if (href === `https://www.youtube.com/watch?v=${firstVideoId}`) {
      return htmlResponse(`
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(firstCaptionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href === `https://www.youtube.com/watch?v=${secondVideoId}`) {
      return htmlResponse('<html><body>Sin captions</body></html>');
    }
    if (href.startsWith(firstCaptionBaseUrl)) {
      return { ok: true, status: 200, text: async () => '' };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraYouTubeTranscript({
    dateYmd: '2026-08-10',
    fetchImpl,
    youtubeApiKey: null,
  });

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'youtube_captions_empty');
  assert.equal(result.captionAttempts.length, 2);
  assert.equal(result.captionAttempts[0].captionTrackCount, 1);
  assert.equal(result.captionAttempts[0].captionBodyLength, 0);
  assert.equal(result.captionAttempts[1].reason, 'youtube_captions_not_found');
});

test('discovers official mañanera livestream archives from the channel streams tab', async () => {
  const videoId = 'liv111AAA22';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Texto de caption oficial simulado para un livestream largo. '.repeat(40);
  const streamMenuFiller = '{"buttonViewModel":{"title":"noop"}},'.repeat(180);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse('<feed></feed>');
    }
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse(`
        <html><body><script>
          var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"richGridRenderer":{"contents":[
            {"richItemRenderer":{"content":{"lockupViewModel":{
              "contentImage":{"thumbnailViewModel":{"image":{"sources":[{"url":"https://i.ytimg.com/vi/${videoId}/hqdefault.jpg"}]}}},
              "rendererContext":{"commandContext":{"onTap":{"innertubeCommand":{"watchEndpoint":{"videoId":"${videoId}"}}}}},
              "menuButton":{"items":[${streamMenuFiller}]},
              "metadata":{"lockupMetadataViewModel":{"title":{"content":"Conferencia de prensa matutina en vivo. Lunes 10 de agosto 2026 | Presidenta Claudia Sheinbaum"}}}
            }}}
          ]}}}}]}}};
        </script></body></html>
      `);
    }
    if (href.startsWith('https://www.googleapis.com/youtube/v3/search')) {
      throw new Error('Data API should not be needed for streams-tab discovery');
    }
    if (href === `https://www.youtube.com/watch?v=${videoId}`) {
      return htmlResponse(`
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(captionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href.startsWith(captionBaseUrl)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [
            { tStartMs: 60000, segs: [{ utf8: `La presidenta habló del INEGI. ${captionFiller}` }] },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraYouTubeTranscript({
    dateYmd: '2026-08-10',
    fetchImpl,
    youtubeApiKey: null,
  });

  assert.equal(result.ready, true);
  assert.equal(result.videoId, videoId);
  assert.equal(result.source, MANANERA_YOUTUBE_CAPTIONS_SOURCE);
  assert.ok(seen.some(url => url.endsWith('/streams')));
  assert.ok(!seen.some(url => url.startsWith('https://www.googleapis.com/youtube/v3/search')));
});

test('accepts official same-day feed video for the Claudia Sheinbaum channel', async () => {
  const videoId = '2CX_dvCjMUk';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Texto de caption oficial simulado para la conferencia completa. '.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse(`
        <feed>
          <entry>
            <yt:videoId>${videoId}</yt:videoId>
            <title>Conferencia de prensa matutina. Lunes 17 de agosto 2026 | Presidenta Claudia Sheinbaum</title>
            <published>2026-08-17T15:20:00Z</published>
            <author><name>Claudia Sheinbaum Pardo</name></author>
          </entry>
        </feed>
      `);
    }
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse('<html><body>Sin streams extra</body></html>');
    }
    if (href === `https://www.youtube.com/watch?v=${videoId}`) {
      return htmlResponse(`
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(captionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href.startsWith(captionBaseUrl)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [
            { tStartMs: 72000, segs: [{ utf8: `La presidenta mencionó huachicol. ${captionFiller}` }] },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraYouTubeTranscript({
    dateYmd: '2026-08-17',
    fetchImpl,
    youtubeApiKey: null,
  });

  assert.equal(result.ready, true);
  assert.equal(result.videoId, videoId);
  assert.equal(result.discovery, 'youtube-feed');
  assert.equal(result.channelTitle, 'Claudia Sheinbaum Pardo');
  assert.ok(seen.some(url => url.startsWith('https://www.youtube.com/feeds/videos.xml')));
  assert.ok(!seen.some(url => url.startsWith('https://www.googleapis.com/youtube/v3/search')));
});

test('discovers same-day mañanera captions from public YouTube search when channel pages miss', async () => {
  const videoId = 'sea111AAA22';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Texto de caption oficial simulado para la conferencia completa. '.repeat(40);
  const seen = [];
  const fetchImpl = async (url) => {
    const href = String(url);
    seen.push(href);
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse('<feed></feed>');
    }
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse('<html><body>Sin streams del día</body></html>');
    }
    if (href.startsWith('https://www.youtube.com/results')) {
      return htmlResponse(`
        <html><body><script>
          var ytInitialData = {"contents":{"sectionListRenderer":{"contents":[{"itemSectionRenderer":{"contents":[
            {"videoRenderer":{
              "videoId":"${videoId}",
              "title":{"runs":[{"text":"Conferencia de prensa matutina. Martes 18 de agosto | Presidenta Claudia Sheinbaum"}]},
              "ownerText":{"runs":[{"text":"Claudia Sheinbaum Pardo"}]}
            }}
          ]}}]}}};
        </script></body></html>
      `);
    }
    if (href.startsWith('https://www.googleapis.com/youtube/v3/search')) {
      throw new Error('Data API should not be needed for public search-page discovery');
    }
    if (href === `https://www.youtube.com/watch?v=${videoId}`) {
      return htmlResponse(`
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(captionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href.startsWith(captionBaseUrl)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [
            { tStartMs: 72000, segs: [{ utf8: `Hoy se habló de huachicol. ${captionFiller}` }] },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraYouTubeTranscript({
    dateYmd: '2026-08-18',
    fetchImpl,
    youtubeApiKey: null,
  });

  assert.equal(result.ready, true);
  assert.equal(result.videoId, videoId);
  assert.equal(result.discovery, 'youtube-search-page');
  assert.equal(result.channelTitle, 'Claudia Sheinbaum Pardo');
  assert.ok(seen.some(url => url.startsWith('https://www.youtube.com/results')));
  assert.ok(!seen.some(url => url.startsWith('https://www.googleapis.com/youtube/v3/search')));
});

test('uses YouTube Data API key as query parameter when feed discovery misses', async () => {
  const videoId = 'api123DEF45';
  const captionBaseUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=es`;
  const captionFiller = 'Texto de caption oficial simulado. '.repeat(40);
  let apiSearchUrl = null;
  let apiSearchHeaders = null;
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('https://www.youtube.com/feeds/videos.xml')) {
      return htmlResponse('<feed></feed>');
    }
    if (href.startsWith('https://www.youtube.com/channel/') && href.endsWith('/streams')) {
      return htmlResponse('<html><body>Sin streams</body></html>');
    }
    if (href.startsWith('https://www.youtube.com/results')) {
      return htmlResponse('<html><body>Sin resultados públicos útiles</body></html>');
    }
    if (href.startsWith('https://www.googleapis.com/youtube/v3/search')) {
      apiSearchUrl = new URL(href);
      apiSearchHeaders = options.headers || {};
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
        <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[
          {"baseUrl":${JSON.stringify(captionBaseUrl)},"languageCode":"es","name":{"simpleText":"Español (generado automáticamente)"},"kind":"asr"}
        ]}}};</script>
      `);
    }
    if (href.startsWith(captionBaseUrl)) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          events: [
            { tStartMs: 12000, segs: [{ utf8: `La presidenta mencionó INEGI. ${captionFiller}` }] },
          ],
        }),
      };
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const result = await findMananeraYouTubeTranscript({
    dateYmd: '2026-08-10',
    fetchImpl,
    youtubeApiKey: 'test-youtube-key',
  });

  assert.equal(result.ready, true);
  assert.equal(result.videoId, videoId);
  assert.equal(apiSearchUrl.searchParams.get('key'), 'test-youtube-key');
  assert.equal(apiSearchHeaders['X-goog-api-key'], undefined);
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
