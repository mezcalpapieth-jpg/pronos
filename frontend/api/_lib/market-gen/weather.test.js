import test from 'node:test';
import assert from 'node:assert/strict';

import { generateWeatherMarkets } from './weather.js';

test('weather generator creates one-degree floor buckets with criteria', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      daily: {
        temperature_2m_max_best_match: [25.6],
      },
    }),
  });

  try {
    const specs = await generateWeatherMarkets();
    const cdmx = specs.find(spec => spec.source_event_id.includes('weather:cdmx:'));

    assert.ok(cdmx);
    assert.deepEqual(cdmx.outcomes, ['< 25°C', '25°C', '26°C', '≥ 27°C']);
    assert.equal(cdmx.resolver_config.buckets[1].minC, 25);
    assert.equal(cdmx.resolver_config.buckets[1].maxC, 26);
    assert.match(cdmx.resolver_config.criteria, /25°C gana desde 25\.00°C hasta 25\.99°C/);
    assert.equal(cdmx.source_data.resolutionCriteria, cdmx.resolver_config.criteria);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
