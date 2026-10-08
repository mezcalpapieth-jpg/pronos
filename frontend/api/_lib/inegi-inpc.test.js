import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INEGI_INPC_BIWEEKLY_ANNUAL_INDICATOR_ID,
  normalizeInegiBiweeklyPeriod,
  readInegiInpcAnnualInflation,
} from './inegi-inpc.js';

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

test('normalizes INEGI biweekly INPC period labels', () => {
  assert.equal(normalizeInegiBiweeklyPeriod('2026-10-1Q'), '2026-10-1Q');
  assert.equal(normalizeInegiBiweeklyPeriod('2026/10/01'), '2026-10-1Q');
  assert.equal(normalizeInegiBiweeklyPeriod('1Q Oct 2026'), '2026-10-1Q');
  assert.equal(normalizeInegiBiweeklyPeriod('primera quincena de octubre de 2026'), '2026-10-1Q');
  assert.equal(normalizeInegiBiweeklyPeriod('segunda quincena de octubre de 2026'), '2026-10-2Q');
});

test('reads target INEGI INPC annual inflation observation from indicator API', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.INEGI_API_TOKEN;
  process.env.INEGI_API_TOKEN = 'test-inegi-token';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalToken == null) delete process.env.INEGI_API_TOKEN;
    else process.env.INEGI_API_TOKEN = originalToken;
  });

  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    assert.match(href, new RegExp(`INDICATOR/${INEGI_INPC_BIWEEKLY_ANNUAL_INDICATOR_ID}/es/00/false/BISE/2\\.0/test-inegi-token`));
    assert.equal(options.headers.accept, 'application/json');
    return jsonResponse({
      Series: [{
        OBSERVATIONS: [
          { TIME_PERIOD: '2026/09/02', OBS_VALUE: '3.42' },
          { TIME_PERIOD: '2026/10/01', OBS_VALUE: '3.63' },
        ],
      }],
    });
  };

  const result = await readInegiInpcAnnualInflation({
    targetPeriod: '2026-10-1Q',
  });

  assert.equal(result.value, 3.63);
  assert.equal(result.period, '2026-10-1Q');
  assert.equal(result.periodRaw, '2026/10/01');
  assert.equal(result.indicatorId, INEGI_INPC_BIWEEKLY_ANNUAL_INDICATOR_ID);
});

test('defers INEGI INPC resolution when target observation is not published', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => jsonResponse({
    Series: [{
      OBSERVATIONS: [
        { TIME_PERIOD: '2026/09/02', OBS_VALUE: '3.42' },
      ],
    }],
  });

  await assert.rejects(
    () => readInegiInpcAnnualInflation({ targetPeriod: '2026-10-1Q' }),
    (err) => {
      assert.equal(err.message, 'inegi_inpc_not_published_for_2026-10-1Q');
      assert.equal(err.benign, true);
      assert.equal(err.info.expectedPeriod, '2026-10-1Q');
      assert.equal(err.info.latestPeriod, '2026-09-2Q');
      return true;
    },
  );
});
