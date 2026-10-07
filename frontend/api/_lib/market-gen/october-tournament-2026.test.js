import test from 'node:test';
import assert from 'node:assert/strict';

import { FEEDS_ARBITRUM_ONE } from '../chainlink.js';
import { generateOctoberTournament2026Markets, _internal } from './october-tournament-2026.js';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

function textResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  };
}

function hexWord(value) {
  return BigInt(value).toString(16).padStart(64, '0');
}

function roundDataHex(price) {
  const answer = BigInt(Math.round(Number(price) * 100_000_000));
  return `0x${[
    hexWord(1),
    hexWord(answer),
    hexWord(1_798_649_900),
    hexWord(1_798_650_000),
    hexWord(1),
  ].join('')}`;
}

test('October tournament generator emits bilingual auto and review specs when configured', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.BANXICO_API_TOKEN;
  process.env.BANXICO_API_TOKEN = 'test-banxico-token';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken == null) delete process.env.BANXICO_API_TOKEN;
    else process.env.BANXICO_API_TOKEN = originalToken;
  });

  const xauFeed = '0x0000000000000000000000000000000000000abc';
  const wtiFeed = '0x0000000000000000000000000000000000000def';
  const prices = new Map([
    [FEEDS_ARBITRUM_ONE.BTC_USD.feedAddress.toLowerCase(), 124500],
    [FEEDS_ARBITRUM_ONE.ETH_USD.feedAddress.toLowerCase(), 4520],
    [xauFeed.toLowerCase(), 3850],
    [wtiFeed.toLowerCase(), 72],
  ]);

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('banxico.org.mx')) {
      assert.equal(options.headers['Bmx-Token'], 'test-banxico-token');
      return jsonResponse({
        bmx: {
          series: [{
            titulo: 'Tipo de Cambio FIX',
            datos: [{ fecha: '29/09/2026', dato: '17.12' }],
          }],
        },
      });
    }
    if (href.includes('publicacionexterna.azurewebsites.net')) {
      return textResponse([
        '<root>',
        '<gas_price type="premium">25.10</gas_price>',
        '<gas_price type="premium">25.30</gas_price>',
        '<gas_price type="regular">23.80</gas_price>',
        '</root>',
      ].join(''));
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      const call = body.params[0];
      if (call.data === '0x313ce567') {
        return jsonResponse({ result: `0x${hexWord(8)}` });
      }
      if (call.data === '0xfeaf968c') {
        return jsonResponse({ result: roundDataHex(prices.get(String(call.to).toLowerCase()) || 100) });
      }
    }
    throw new Error(`unexpected fetch ${href}`);
  };

  const specs = await generateOctoberTournament2026Markets({
    env: {
      CHAINLINK_XAU_USD_FEED_ADDRESS: xauFeed,
      CHAINLINK_XAU_USD_SYMBOL: 'XAU/USD',
      CHAINLINK_WTI_USD_FEED_ADDRESS: wtiFeed,
      CHAINLINK_WTI_USD_SYMBOL: 'WTI/USD',
      OCTOBER_NOBEL_PEACE_CANDIDATES: 'Candidate A,Candidate B,Candidate C,Candidate D,Candidate E,Candidate F',
      OCTOBER_BALLON_DOR_CANDIDATES: 'Kane,Mbappe,Haaland,Yamal,Vinicius,Bellingham',
    },
    now: new Date('2026-10-01T15:30:00.000Z'),
  });

  assert.equal(specs.length, 21);
  const byEventId = Object.fromEntries(specs.map(spec => [spec.source_event_id, spec]));
  assert.equal(Object.values(byEventId).every(spec => spec.tournament_featured === true), true);

  const usd = byEventId['october-2026:usd-mxn-close'];
  assert.equal(usd.resolver_type, 'api_price');
  assert.equal(usd.resolver_config.shape, 'price-bucket');
  assert.equal(usd.source_data.translations.en.question, 'USD/MXN October 2026 close');
  assert.equal(usd.source_data.translations.en.outcomes.length, usd.outcomes.length);

  const btc = byEventId['october-2026:btc-usd-close'];
  assert.equal(btc.resolver_type, 'chainlink_price');
  assert.equal(btc.resolver_config.closesAt, '2026-10-30T21:00:00.000Z');

  const goldWeekly = byEventId['october-2026:xau-usd-weekly-2026-10-07'];
  assert.equal(goldWeekly.question, 'Oro (XAU/USD): cierre semanal 2026-10-07');
  assert.equal(goldWeekly.resolver_type, 'chainlink_price');
  assert.equal(goldWeekly.resolver_config.closesAt, '2026-10-07T21:00:00.000Z');
  assert.equal(goldWeekly.source_data.translations.en.question, 'Gold (XAU/USD): weekly close 2026-10-07');

  const oilMonthly = byEventId['october-2026:wti-usd-close'];
  assert.equal(oilMonthly.question, 'Petróleo WTI (WTI/USD): cierre mensual de octubre 2026');
  assert.equal(oilMonthly.resolver_type, 'chainlink_price');
  assert.equal(oilMonthly.resolver_config.chainId, 56);

  const hurricane = byEventId['october-2026:mexico-major-hurricane-landfall'];
  assert.equal(hurricane.resolver_type, 'api_hurricane');
  assert.equal(hurricane.tournament_featured, true);
  assert.deepEqual(hurricane.outcomes, ['Sí', 'No']);
  assert.equal(hurricane.source_data.translations.en.question, 'Will a Category 4 or 5 hurricane make landfall in Mexico during October 2026?');

  const fed = byEventId['october-2026:fed-october-decision'];
  assert.equal(fed.resolver_type, 'manual_review');
  assert.deepEqual(fed.outcomes, ['Recorta', 'Mantiene', 'Sube']);
  assert.deepEqual(fed.source_data.translations.en.outcomes, ['Cut', 'Hold', 'Hike']);

  const popocatepetl = byEventId['october-2026:popocatepetl-exhalations-2026-10-02'];
  assert.equal(popocatepetl.resolver_type, 'manual_review');
  assert.equal(popocatepetl.end_time, '2026-10-02T16:29:00.000Z');
  assert.deepEqual(popocatepetl.outcomes, ['0 a 19', '20 a 49', '50 a 99', '100 o más']);
  assert.equal(popocatepetl.source_data.targetDateYmd, '2026-10-02');
  assert.match(popocatepetl.resolver_config.criteria, /CENAPRED/);
  assert.match(popocatepetl.resolver_config.criteria, /exhalaciones/);
  assert.equal(popocatepetl.source_data.buckets[3].min, 100);

  const amilcar = byEventId['october-2026:amilcar-olan-official-investigation'];
  assert.equal(amilcar.resolver_type, 'manual_review');
  assert.equal(amilcar.end_time, '2026-10-31T05:59:00.000Z');
  assert.deepEqual(amilcar.outcomes, ['Sí', 'No']);
  assert.match(amilcar.resolver_config.criteria, /UIF\/SHCP/);
  assert.match(amilcar.resolver_config.criteria, /FGR/);
  assert.match(amilcar.resolver_config.criteria, /No cuentan/);
  assert.deepEqual(amilcar.source_data.allowedAuthorities, ['UIF/SHCP', 'FGR/Fiscalía General de la República']);

  const tortilla = byEventId['october-2026:tortilla-national-tortilleria-close'];
  assert.equal(tortilla.resolver_type, 'api_price');
  assert.equal(tortilla.resolver_config.source, 'sniim-food-price');
  assert.equal(tortilla.resolver_config.commodity, 'tortilla');
  assert.equal(tortilla.resolver_config.targetMonth, 10);
  assert.equal(tortilla.resolver_config.shape, 'price-bucket');
  assert.equal(tortilla.source_data.kind, 'october_tournament_food_price');
  assert.equal(tortilla.source_data.translations.en.question, 'Corn tortilla: national tortilleria price at October 2026 close');
  assert.equal(tortilla.source_data.buckets[0].max, 23);
  assert.match(tortilla.resolver_config.criteria, /SNIIM/);

  const avocado = byEventId['october-2026:avocado-hass-cdmx-wholesale-close'];
  assert.equal(avocado.resolver_type, 'api_price');
  assert.equal(avocado.resolver_config.source, 'sniim-food-price');
  assert.equal(avocado.resolver_config.commodity, 'aguacate_hass');
  assert.equal(avocado.resolver_config.dateEndYmd, '2026-10-31');
  assert.equal(avocado.source_data.translations.en.question, 'Hass avocado: Mexico City wholesale price at October 2026 close');
  assert.equal(avocado.source_data.market, 'Central de Abasto CDMX');
  assert.equal(avocado.source_data.bucketTieRule, 'upper_bucket');

  const whiteCorn = byEventId['october-2026:white-corn-wholesale-close'];
  assert.equal(whiteCorn.resolver_type, 'api_price');
  assert.equal(whiteCorn.resolver_config.source, 'sniim-food-price');
  assert.equal(whiteCorn.resolver_config.commodity, 'maiz_blanco');
  assert.equal(whiteCorn.resolver_config.destinoId, 100);
  assert.equal(whiteCorn.source_data.translations.en.question, 'White corn: wholesale price at October 2026 close');
  assert.equal(whiteCorn.source_data.unit, 'MXN/t');
  assert.equal(whiteCorn.source_data.rawUnit, 'MXN/kg');
  assert.equal(whiteCorn.source_data.evidence.length, 1);

  const whiteEgg = byEventId['october-2026:white-egg-cdmx-wholesale-close'];
  assert.equal(whiteEgg.resolver_type, 'api_price');
  assert.equal(whiteEgg.resolver_config.source, 'sniim-food-price');
  assert.equal(whiteEgg.resolver_config.commodity, 'huevo_blanco');
  assert.equal(whiteEgg.resolver_config.destino, 100);
  assert.equal(whiteEgg.resolver_config.productCode, 'H01');
  assert.equal(whiteEgg.source_data.translations.en.question, 'White egg: Mexico City wholesale price at October 2026 close');
  assert.equal(whiteEgg.source_data.market, 'Central de Abasto de Iztapalapa');
  assert.equal(whiteEgg.source_data.unit, 'MXN/kg');
  assert.equal(whiteEgg.source_data.buckets[0].max, 25);

  const nobel = byEventId['october-2026:nobel-peace-prize'];
  assert.equal(nobel.outcomes.length, 7);
  assert.equal(nobel.outcomes[6], 'Otro');
});

test('October award markets have default candidates when env lists are not configured', () => {
  const specs = _internal.manualMarkets({});
  const byEventId = Object.fromEntries(specs.map(spec => [spec.source_event_id, spec]));

  const nobel = byEventId['october-2026:nobel-peace-prize'];
  assert.ok(nobel);
  assert.deepEqual(nobel.outcomes, [
    ..._internal.DEFAULT_NOBEL_PEACE_CANDIDATES_ES,
    'Otro',
  ]);
  assert.deepEqual(nobel.source_data.translations.en.outcomes, [
    ..._internal.DEFAULT_NOBEL_PEACE_CANDIDATES_EN,
    'Other',
  ]);
  assert.equal(nobel.tournament_featured, true);

  const ballonDor = byEventId['october-2026:ballon-dor-men'];
  assert.ok(ballonDor);
  assert.deepEqual(ballonDor.outcomes, [
    ..._internal.DEFAULT_BALLON_DOR_CANDIDATES,
    'Otro',
  ]);
  assert.equal(ballonDor.tournament_featured, true);
});
