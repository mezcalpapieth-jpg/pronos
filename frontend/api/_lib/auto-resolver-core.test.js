import test from 'node:test';
import assert from 'node:assert/strict';

import { MANANERA_TRANSCRIPT_SOURCE } from './mananera.js';
import { buildAutoResolverFinalScore, resolveAutoResolverCandidate } from './auto-resolver-core.js';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function htmlResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

test('auto resolver core falls back from football-data to ESPN soccer scoreboards', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FOOTBALL_DATA_API_KEY;
  delete process.env.FOOTBALL_DATA_API_KEY;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = originalKey;
  });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /soccer\/conmebol\.libertadores\/scoreboard/);
    return jsonResponse({
      events: [{
        id: '401865536',
        competitions: [{
          status: { type: { state: 'post', completed: true } },
          competitors: [
            {
              homeAway: 'home',
              score: '2',
              winner: false,
              team: { displayName: 'Cusco FC', shortDisplayName: 'Cusco' },
            },
            {
              homeAway: 'away',
              score: '3',
              winner: true,
              team: { displayName: 'Independiente Medellín', shortDisplayName: 'Ind. Medellín' },
            },
          ],
        }],
      }],
    });
  };

  const decision = await resolveAutoResolverCandidate({
    resolver_type: 'sports_api',
    resolver_config: { source: 'football-data', matchId: 557093, shape: 'draw3' },
    pending_source_data: {
      competitionCode: 'CLI',
      kickoffUtc: '2026-05-21T02:00:00.000Z',
      home: { name: 'Cusco' },
      away: { name: 'Independiente' },
    },
    sport: 'soccer',
    league: 'copa-libertadores',
    start_time: '2026-05-21T02:00:00.000Z',
    outcomes: ['Cusco', 'Empate', 'Independiente'],
  });

  assert.equal(decision.winningIdx, 2);
  assert.equal(decision.cfg.source, 'espn');
  assert.equal(decision.cfg.originalSource, 'football-data');
  assert.equal(decision.resolverInfo.source, 'espn');
  assert.equal(decision.result.completed, true);
  assert.equal(decision.finalScore, 'Cusco 2-3 Ind. Medellín');
  assert.deepEqual(decision.resolverConfigPatch, {
    source: 'espn',
    leaguePath: 'soccer/conmebol.libertadores',
    eventId: null,
    dateYmd: '2026-05-21',
    homeName: 'Cusco',
    awayName: 'Independiente',
    shape: 'draw3',
    originalSource: 'football-data',
    originalMatchId: '557093',
  });
});

test('auto resolver core settles crypto binary-direction markets from Coinbase boundary candles', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /products\/BTC-USD\/candles/);
    return jsonResponse([
      [1786180140, 64940, 64970, 64950, 64963.49, 3.1],
    ]);
  };

  const decision = await resolveAutoResolverCandidate({
    resolver_type: 'chainlink_price',
    resolver_config: {
      source: 'chainlink',
      feedAddress: '0x6ce185860a4963106506C203335A2910413708e9',
      chainId: 42161,
      symbol: 'BTC/USD',
      shape: 'binary-direction',
      asset: 'btc',
      coinbaseProductId: 'BTC-USD',
      threshold: 64957,
      closesAt: '2026-08-08T09:10:00.000Z',
    },
    end_time: '2026-08-08T09:10:00.000Z',
    outcomes: ['SUBE', 'BAJA'],
  });

  assert.equal(decision.winningIdx, 0);
  assert.equal(decision.resolverInfo.priceAtResolve, 64963.49);
  assert.equal(decision.resolverInfo.source, 'coinbase-candle');
  assert.equal(decision.finalScore, '$64957 -> $64963.49');
  assert.deepEqual(decision.resolverConfigPatch, {
    closePrice: 64963.49,
    closePriceSource: 'coinbase-candle',
    closePriceAt: '2026-08-08T09:10:00.000Z',
  });
});

test('auto resolver core settles mañanera transcript phrase markets', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://www.gob.mx/busqueda')) {
      return htmlResponse('<a href="/presidencia/articulos/version-estenografica-de-la-conferencia-matutina-del-pueblo-10-de-agosto-de-2026">Transcripción</a>');
    }
    return htmlResponse(`
      <html>
        <head><title>Versión estenográfica de la conferencia matutina del pueblo, 10 de agosto de 2026</title></head>
        <body>
          <article>
            <p>10 de agosto de 2026</p>
            <p>La seguridad pública y la seguridad nacional fueron mencionadas.</p>
            <p>${'Texto oficial simulado para superar el mínimo de extracción. '.repeat(20)}</p>
          </article>
        </body>
      </html>
    `);
  };

  const decision = await resolveAutoResolverCandidate({
    resolver_type: 'api_transcript',
    resolver_config: {
      source: MANANERA_TRANSCRIPT_SOURCE,
      dateYmd: '2026-08-10',
      phrase: 'seguridad',
      op: 'gte',
      threshold: 2,
      yesOutcome: 0,
    },
    outcomes: ['Sí', 'No'],
  });

  assert.equal(decision.winningIdx, 0);
  assert.equal(decision.resolverInfo.source, MANANERA_TRANSCRIPT_SOURCE);
  assert.equal(decision.resolverInfo.matchCount, 2);
  assert.equal(decision.finalScore, '2 menciones de "seguridad"');
  assert.equal(decision.resolverConfigPatch.transcriptMatchCount, 2);
  assert.match(decision.resolverConfigPatch.transcriptUrl, /version-estenografica/);
});

test('auto resolver final score includes required transcript timestamps when available', () => {
  const score = buildAutoResolverFinalScore({
    resolverType: 'api_transcript',
    cfg: { phrase: 'seguridad', threshold: 5 },
    resolverInfo: {
      matchCount: 7,
      requiredMatchTimestamps: [
        { label: '2:01' },
        { label: '3:05' },
        { label: '4:06' },
        { label: '5:07' },
        { label: '6:08' },
      ],
    },
    outcomes: ['Sí', 'No'],
    winningIdx: 0,
  });

  assert.equal(score, '7 menciones de "seguridad" · 2:01, 3:05, 4:06, 5:07, 6:08');
});
