import test from 'node:test';
import assert from 'node:assert/strict';

import { generateFxMarkets } from './fx.js';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test('fx generator creates Friday-close MXN crosses from Frankfurter without Banxico token', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.BANXICO_API_TOKEN;
  delete process.env.BANXICO_API_TOKEN;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken == null) delete process.env.BANXICO_API_TOKEN;
    else process.env.BANXICO_API_TOKEN = originalToken;
  });

  const rates = {
    'EUR/MXN': 21.41,
    'JPY/MXN': 0.116,
    'CHF/MXN': 22.87,
    'GBP/MXN': 24.86,
    'CAD/MXN': 12.26,
    'BRL/MXN': 3.11,
  };
  globalThis.fetch = async (url) => {
    const match = String(url).match(/rate\/([A-Z]{3})\/([A-Z]{3})/);
    assert.ok(match, `unexpected Frankfurter URL: ${url}`);
    const pair = `${match[1]}/${match[2]}`;
    return jsonResponse({
      date: '2026-08-28',
      base: match[1],
      quote: match[2],
      rate: rates[pair],
    });
  };

  const specs = await generateFxMarkets();

  assert.equal(specs.length, 6);
  assert.deepEqual(specs.map(spec => spec.source_event_id.split(':')[1]), [
    'EURMXN',
    'JPYMXN',
    'CHFMXN',
    'GBPMXN',
    'CADMXN',
    'BRLMXN',
  ]);
  const eur = specs.find(spec => spec.source_data.pair === 'EUR/MXN');
  const jpy = specs.find(spec => spec.source_data.pair === 'JPY/MXN');
  assert.match(eur.question, /EUR\/MXN cierre del viernes > \$21\.50/);
  assert.match(jpy.question, /JPY\/MXN cierre del viernes > \$0\.120/);
  assert.equal(eur.resolver_type, 'api_price');
  assert.equal(eur.resolver_config.source, 'frankfurter');
  assert.equal(eur.resolver_config.resolveDateYmd, eur.source_data.resolveDateYmd);
  assert.match(eur.resolver_config.criteria, /Frankfurter/);
});
