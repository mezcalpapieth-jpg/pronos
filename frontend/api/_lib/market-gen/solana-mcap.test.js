import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOGGY_TOKEN_MCAP_MARKET,
  generateSolanaMcapMarkets,
} from './solana-mcap.js';
import { COINGECKO_TOKEN_MCAP_SOURCE } from '../solana-token-mcap.js';

test('DOGGY token market-cap generator emits strict above-threshold oracle config', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return [{
        id: DOGGY_TOKEN_MCAP_MARKET.coinId,
        symbol: 'doggy',
        current_price: 0.00013,
        market_cap: 130000,
        circulating_supply: 1000000000,
        last_updated: '2026-08-20T16:00:00.000Z',
      }];
    },
  });

  const specs = await generateSolanaMcapMarkets({
    now: new Date('2026-08-20T12:00:00.000Z'),
  });
  assert.equal(specs.length, 1);
  const spec = specs[0];
  assert.equal(spec.source, 'coingecko');
  assert.equal(spec.category, 'crypto');
  assert.equal(spec.end_time, '2026-08-24T05:59:59.000Z');
  assert.match(spec.question, /\$DOGGY cerrará arriba de \$125K/);
  assert.equal(spec.resolver_type, 'api_price');
  assert.equal(spec.resolver_config.source, COINGECKO_TOKEN_MCAP_SOURCE);
  assert.equal(spec.resolver_config.op, 'gt');
  assert.equal(spec.resolver_config.threshold, 125000);
  assert.equal(spec.resolver_config.yesOutcome, 0);
  assert.equal(spec.resolver_config.tokenAddress, DOGGY_TOKEN_MCAP_MARKET.tokenAddress);
  assert.equal(spec.source_data.spotAtGeneration, 130000);
  assert.match(spec.source_data.resolutionCriteria, /Exactamente \$125,000 no cuenta/);
});

test('DOGGY generator does not re-create the market after close', async () => {
  const specs = await generateSolanaMcapMarkets({
    now: new Date('2026-08-24T06:00:00.000Z'),
  });
  assert.deepEqual(specs, []);
});
