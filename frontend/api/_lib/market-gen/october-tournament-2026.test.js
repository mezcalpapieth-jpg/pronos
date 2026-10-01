import test from 'node:test';
import assert from 'node:assert/strict';

import { FEEDS_ARBITRUM_ONE } from '../chainlink.js';
import { generateOctoberTournament2026Markets } from './october-tournament-2026.js';

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
      CHAINLINK_WTI_USD_CHAIN_ID: '56',
      CHAINLINK_WTI_USD_SYMBOL: 'WTI/USD',
      OCTOBER_NOBEL_PEACE_CANDIDATES: 'Candidate A,Candidate B,Candidate C,Candidate D,Candidate E,Candidate F',
      OCTOBER_BALLON_DOR_CANDIDATES: 'Kane,Mbappe,Haaland,Yamal,Vinicius,Bellingham',
    },
    now: new Date('2026-10-01T15:30:00.000Z'),
  });

  assert.equal(specs.length, 15);
  const byEventId = Object.fromEntries(specs.map(spec => [spec.source_event_id, spec]));

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
  assert.deepEqual(hurricane.outcomes, ['Sí', 'No']);
  assert.equal(hurricane.source_data.translations.en.question, 'Will a Category 4 or 5 hurricane make landfall in Mexico during October 2026?');

  const fed = byEventId['october-2026:fed-october-decision'];
  assert.equal(fed.resolver_type, 'manual_review');
  assert.deepEqual(fed.outcomes, ['Recorta', 'Mantiene', 'Sube']);
  assert.deepEqual(fed.source_data.translations.en.outcomes, ['Cut', 'Hold', 'Hike']);

  const nobel = byEventId['october-2026:nobel-peace-prize'];
  assert.equal(nobel.outcomes.length, 7);
  assert.equal(nobel.outcomes[6], 'Otro');
});
