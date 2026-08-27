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

test('auto resolver core settles Banxico FIX only when the target date is published', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.BANXICO_API_TOKEN;
  process.env.BANXICO_API_TOKEN = 'test-banxico-token';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken == null) delete process.env.BANXICO_API_TOKEN;
    else process.env.BANXICO_API_TOKEN = originalToken;
  });

  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /series\/SF43718\/datos\/oportuno/);
    assert.equal(options.headers['Bmx-Token'], 'test-banxico-token');
    return jsonResponse({
      bmx: {
        series: [{
          titulo: 'Tipo de Cambio FIX',
          datos: [{ fecha: '15/08/2026', dato: '16.98' }],
        }],
      },
    });
  };

  const decision = await resolveAutoResolverCandidate({
    resolver_type: 'api_price',
    resolver_config: {
      source: 'banxico-fix',
      seriesId: 'SF43718',
      threshold: 17,
      op: 'lt',
      yesOutcome: 0,
      resolveDateYmd: '2026-08-15',
    },
    end_time: '2026-08-16T03:59:00.000Z',
    outcomes: ['Sí', 'No'],
  });

  assert.equal(decision.winningIdx, 0);
  assert.equal(decision.resolverInfo.priceAtResolve, 16.98);
  assert.equal(decision.resolverInfo.fecha, '15/08/2026');
  assert.equal(decision.resolverInfo.targetDateYmd, '2026-08-15');
  assert.equal(decision.finalScore, 'banxico-fix · 16.98');
});

test('auto resolver core sends archive weather model mismatches to manual review', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const hourlyTimes = Array.from({ length: 24 }, (_, hour) =>
    `2024-01-01T${String(hour).padStart(2, '0')}:00`);
  const hourlyTemps = hourlyTimes.map((_, hour) => (hour === 14 ? 23.9 : 19 + hour * 0.1));
  const buckets = [
    { label: '< 23°C', minC: -999, maxC: 23 },
    { label: '23°C', minC: 23, maxC: 24 },
    { label: '24°C', minC: 24, maxC: 25 },
    { label: '≥ 25°C', minC: 25, maxC: 999 },
  ];

  globalThis.fetch = async (url) => {
    if (String(url).includes('archive-api.open-meteo.com')) {
      return jsonResponse({
        daily: { temperature_2m_max: [23.9] },
        hourly: {
          time: hourlyTimes,
          temperature_2m: hourlyTemps,
        },
      });
    }
    return jsonResponse({
      daily: {
        temperature_2m_max_best_match: [23.9],
        temperature_2m_max_gfs_seamless: [24.8],
        temperature_2m_max_ecmwf_ifs025: [23.3],
        temperature_2m_max_icon_seamless: [25.8],
      },
    });
  };

  await assert.rejects(
    () => resolveAutoResolverCandidate({
      resolver_type: 'weather_api',
      resolver_config: {
        source: 'open-meteo',
        resolutionSource: 'open-meteo-archive',
        lat: 19.4326,
        lng: -99.1332,
        timezone: 'America/Mexico_City',
        forecastDateYmd: '2024-01-01',
        manualReviewDeltaC: 1.5,
        buckets,
      },
      outcomes: buckets.map(bucket => bucket.label),
    }),
    (err) => {
      assert.equal(err.message, 'weather_manual_review_required');
      assert.equal(err.benign, true);
      assert.equal(err.manualReview, true);
      assert.equal(err.info.suggestedOutcomeIndex, 1);
      assert.equal(err.info.weatherAudit.requiresManualReview, true);
      return true;
    },
  );
});

test('auto resolver core settles Solana token mcap markets from stored CoinGecko snapshots', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const tokenAddress = 'BS7HxRitaY5ipGfbek1nmatWLbaS9yoWRSEQzCb3pump';
  const sql = {
    query: async () => ({
      rows: [{
        id: 91,
        market_id: 444,
        coin_id: 'holder',
        network: 'solana',
        token_address: tokenAddress,
        source: 'coingecko-markets',
        market_cap_usd: '125000',
        price_usd: '0.000125',
        circulating_supply: '1000000000',
        total_supply: '1000000000',
        fdv_usd: '125000',
        captured_at: new Date('2026-08-24T05:59:40.000Z'),
        source_updated_at: new Date('2026-08-24T05:59:20.000Z'),
        raw: { symbol: 'doggy' },
      }],
    }),
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes('/tokens/')) {
      return jsonResponse({
        data: [
          { id: 'solana_pool', attributes: { address: 'pool-address-1234567890', reserve_in_usd: '5000' } },
        ],
      });
    }
    assert.match(text, /ohlcv\/minute/);
    return jsonResponse({
      data: {
        attributes: {
          ohlcv_list: [
            [1787551140, 0.000125, 0.000125, 0.000125, 0.000125, 10],
          ],
        },
      },
    });
  };

  const decision = await resolveAutoResolverCandidate({
    id: 444,
    resolver_type: 'api_price',
    resolver_config: {
      source: 'coingecko-token-mcap',
      coinId: 'holder',
      network: 'solana',
      tokenAddress,
      symbol: 'DOGGY',
      threshold: 125000,
      op: 'gt',
      yesOutcome: 0,
      closesAt: '2026-08-24T05:59:59.000Z',
      snapshotToleranceSeconds: 300,
      disputeBps: 200,
    },
    end_time: '2026-08-24T05:59:59.000Z',
    outcomes: ['Sí', 'No'],
  }, { sql });

  assert.equal(decision.winningIdx, 1);
  assert.equal(decision.resolverInfo.priceAtResolve, 125000);
  assert.equal(decision.resolverInfo.source, 'coingecko-token-mcap');
  assert.equal(decision.resolverInfo.verificationMarketCap, 125000);
  assert.equal(decision.finalScore, 'DOGGY · 125,000');
  assert.equal(decision.resolverConfigPatch.closeMarketCapUsd, 125000);
  assert.equal(decision.resolverConfigPatch.verificationMarketCapUsd, 125000);
});

test('auto resolver core settles AICM delay-count bucket markets from stored oracle evidence', async () => {
  const calls = [];
  const sql = {
    query: async (statement, params) => {
      calls.push({ statement, params });
      return {
        rows: [{
          count: 18,
          flights_with_any_status: 180,
          poll_count: 260,
          ok_poll_count: 244,
          first_observed_at: '2026-08-20T06:00:00.000Z',
          last_observed_at: '2026-08-21T05:57:00.000Z',
          last_poll_observed_at: '2026-08-21T05:58:00.000Z',
        }],
      };
    },
  };

  const decision = await resolveAutoResolverCandidate({
    resolver_type: 'aicm_delay_count',
    resolver_config: {
      source: 'aicm-official-flight-board',
      shape: 'delay-bucket',
      direction: 'departure',
      fromDateYmd: '2026-08-20',
      toDateYmd: '2026-08-20',
      minObservedPolls: 36,
      minObservedFlights: 20,
      buckets: [
        { label: '0-5', minCount: 0, maxCount: 5 },
        { label: '6-15', minCount: 6, maxCount: 15 },
        { label: '16-30', minCount: 16, maxCount: 30 },
        { label: '31+', minCount: 31, maxCount: null },
      ],
    },
    outcomes: ['0-5', '6-15', '16-30', '31+'],
  }, { sql });

  assert.equal(decision.winningIdx, 2);
  assert.equal(decision.resolverInfo.count, 18);
  assert.equal(decision.finalScore, '18 salidas demoradas');
  assert.equal(calls[0].params[0], '2026-08-20');
  assert.equal(calls[0].params[2], 'departure');
});

test('auto resolver core defers AICM markets when oracle coverage is too thin', async () => {
  const sql = {
    query: async () => ({
      rows: [{
        count: 0,
        flights_with_any_status: 0,
        poll_count: 1,
        ok_poll_count: 1,
        last_poll_observed_at: '2026-08-20T07:00:00.000Z',
      }],
    }),
  };

  await assert.rejects(
    resolveAutoResolverCandidate({
      resolver_type: 'aicm_delay_count',
      resolver_config: {
        source: 'aicm-official-flight-board',
        fromDateYmd: '2026-08-20',
        toDateYmd: '2026-08-20',
        minObservedPolls: 36,
        minObservedFlights: 20,
        buckets: [{ label: '0-5', minCount: 0, maxCount: 5 }],
      },
      outcomes: ['0-5'],
    }, { sql }),
    (err) => err?.benign === true && err?.message === 'aicm_oracle_observations_not_ready',
  );
});

test('auto resolver core defers Banxico FIX when latest value is from an earlier day', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.BANXICO_API_TOKEN;
  process.env.BANXICO_API_TOKEN = 'test-banxico-token';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken == null) delete process.env.BANXICO_API_TOKEN;
    else process.env.BANXICO_API_TOKEN = originalToken;
  });

  globalThis.fetch = async () => jsonResponse({
    bmx: {
      series: [{
        titulo: 'Tipo de Cambio FIX',
        datos: [{ fecha: '14/08/2026', dato: '16.98' }],
      }],
    },
  });

  await assert.rejects(
    resolveAutoResolverCandidate({
      resolver_type: 'api_price',
      resolver_config: {
        source: 'banxico-fix',
        seriesId: 'SF43718',
        threshold: 17,
        op: 'lt',
        yesOutcome: 0,
        resolveDateYmd: '2026-08-15',
      },
      end_time: '2026-08-16T03:59:00.000Z',
      outcomes: ['Sí', 'No'],
    }),
    (err) => {
      assert.equal(err.message, 'banxico_fix_not_published_for_2026-08-15');
      assert.equal(err.benign, true);
      assert.equal(err.info.expectedDateYmd, '2026-08-15');
      assert.equal(err.info.latestDateYmd, '2026-08-14');
      assert.equal(err.info.latestFecha, '14/08/2026');
      return true;
    },
  );
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

test('auto resolver core settles F1 Dutch GP side markets from race classifications', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /ergast\/f1\/2026\/12\/results\.json/);
    return jsonResponse({
      MRData: {
        RaceTable: {
          Races: [{
            Results: [
              {
                position: '1',
                positionOrder: '1',
                points: '25',
                Driver: { driverId: 'max_verstappen', givenName: 'Max', familyName: 'Verstappen' },
                Constructor: { constructorId: 'red_bull', name: 'Red Bull Racing' },
              },
              {
                position: '3',
                positionOrder: '3',
                points: '15',
                Driver: { driverId: 'norris', givenName: 'Lando', familyName: 'Norris' },
                Constructor: { constructorId: 'mclaren', name: 'McLaren' },
              },
              {
                position: '9',
                positionOrder: '9',
                points: '2',
                Driver: { driverId: 'perez', givenName: 'Sergio', familyName: 'Pérez' },
                Constructor: { constructorId: 'cadillac', name: 'Cadillac' },
              },
              {
                position: '13',
                positionOrder: '13',
                points: '0',
                Driver: { driverId: 'bottas', givenName: 'Valtteri', familyName: 'Bottas' },
                Constructor: { constructorId: 'cadillac', name: 'Cadillac' },
              },
            ],
          }],
        },
      },
    });
  };

  const ahead = await resolveAutoResolverCandidate({
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'jolpica-f1',
      season: '2026',
      round: '12',
      shape: 'driver-ahead',
      driverAId: 'perez',
      driverALabel: 'Sergio Pérez',
      driverBId: 'bottas',
      driverBLabel: 'Valtteri Bottas',
    },
    outcomes: ['Checo Pérez', 'Valtteri Bottas'],
  });
  assert.equal(ahead.winningIdx, 0);
  assert.equal(ahead.finalScore, 'Sergio Pérez P9 · Valtteri Bottas P13');

  const maxWins = await resolveAutoResolverCandidate({
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'jolpica-f1',
      season: '2026',
      round: '12',
      shape: 'driver-wins',
      driverId: 'max_verstappen',
      driverLabel: 'Max Verstappen',
    },
    outcomes: ['Sí', 'No'],
  });
  assert.equal(maxWins.winningIdx, 0);
  assert.equal(maxWins.finalScore, 'Max Verstappen ganó');

  const norrisPodium = await resolveAutoResolverCandidate({
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'jolpica-f1',
      season: '2026',
      round: '12',
      shape: 'driver-podium',
      driverId: 'norris',
      driverLabel: 'Lando Norris',
    },
    outcomes: ['Sí', 'No'],
  });
  assert.equal(norrisPodium.winningIdx, 0);
  assert.equal(norrisPodium.finalScore, 'Lando Norris P3');

  const perezPoints = await resolveAutoResolverCandidate({
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'jolpica-f1',
      season: '2026',
      round: '12',
      shape: 'driver-points',
      driverId: 'perez',
      driverLabel: 'Sergio Pérez',
    },
    outcomes: ['Sí', 'No'],
  });
  assert.equal(perezPoints.winningIdx, 0);
  assert.equal(perezPoints.finalScore, 'Sergio Pérez: 2 pts');

  const cadillacPoints = await resolveAutoResolverCandidate({
    resolver_type: 'sports_api',
    resolver_config: {
      source: 'jolpica-f1',
      season: '2026',
      round: '12',
      shape: 'constructor-points',
      constructorId: 'cadillac',
      constructorLabel: 'Cadillac',
    },
    outcomes: ['Sí', 'No'],
  });
  assert.equal(cadillacPoints.winningIdx, 0);
  assert.equal(cadillacPoints.finalScore, 'Cadillac: 2 pts');
});
