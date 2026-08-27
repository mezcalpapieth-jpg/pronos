import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptiveBuckets,
  buildWeatherModelAudit,
  isWeatherArchiveDateComplete,
  resolveObservedWeatherMaxTempC,
  weatherBucketIndexFor,
  weatherResolutionCriteriaForBuckets,
} from './weather.js';

test('weather adaptive buckets use one-degree floor ranges', () => {
  const buckets = adaptiveBuckets(25.6);

  assert.deepEqual(
    buckets.map(b => b.label),
    ['< 25°C', '25°C', '26°C', '≥ 27°C'],
  );
  assert.equal(weatherBucketIndexFor(24.99, buckets), 0);
  assert.equal(weatherBucketIndexFor(25, buckets), 1);
  assert.equal(weatherBucketIndexFor(25.99, buckets), 1);
  assert.equal(weatherBucketIndexFor(26, buckets), 2);
  assert.equal(weatherBucketIndexFor(26.99, buckets), 2);
  assert.equal(weatherBucketIndexFor(27, buckets), 3);
});

test('weather criteria explains exact non-rounded bucket boundaries', () => {
  const criteria = weatherResolutionCriteriaForBuckets(adaptiveBuckets(25.6));

  assert.match(criteria, /< 25°C gana con cualquier valor menor a 25\.00°C/);
  assert.match(criteria, /25°C gana desde 25\.00°C hasta 25\.99°C/);
  assert.match(criteria, /26°C gana desde 26\.00°C hasta 26\.99°C/);
  assert.match(criteria, /≥ 27°C gana con 27\.00°C o más/);
});

test('weather archive criteria explains actual observed resolution', () => {
  const criteria = weatherResolutionCriteriaForBuckets(adaptiveBuckets(25.6), {
    resolutionSource: 'open-meteo-archive',
  });

  assert.match(criteria, /Open-Meteo Archive/);
  assert.match(criteria, /best_match/);
  assert.match(criteria, /temperatura máxima horaria registrada/);
  assert.match(criteria, /pasa a revisión manual/);
});

test('weather archive only resolves after the local market date is complete', () => {
  assert.equal(isWeatherArchiveDateComplete({
    dateYmd: '2026-08-26',
    timezone: 'America/Mexico_City',
    now: new Date('2026-08-26T23:30:00.000Z'),
  }), false);

  assert.equal(isWeatherArchiveDateComplete({
    dateYmd: '2026-08-26',
    timezone: 'America/Mexico_City',
    now: new Date('2026-08-27T12:00:00.000Z'),
  }), true);
});

test('observed weather resolver uses archive max and flags model bucket mismatch', async () => {
  const originalFetch = globalThis.fetch;
  const buckets = adaptiveBuckets(23.9);
  const hourlyTimes = Array.from({ length: 24 }, (_, hour) =>
    `2026-08-26T${String(hour).padStart(2, '0')}:00`);
  const hourlyTemps = hourlyTimes.map((_, hour) => (hour === 14 || hour === 15 ? 23.9 : 20 + hour * 0.1));
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('archive-api.open-meteo.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          daily: { temperature_2m_max: [23.9] },
          hourly: {
            time: hourlyTimes,
            temperature_2m: hourlyTemps,
          },
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        daily: {
          temperature_2m_max_best_match: [23.9],
          temperature_2m_max_gfs_seamless: [24.8],
          temperature_2m_max_ecmwf_ifs025: [23.3],
          temperature_2m_max_icon_seamless: [25.8],
        },
      }),
    };
  };

  try {
    const resolved = await resolveObservedWeatherMaxTempC({
      lat: 19.4326,
      lng: -99.1332,
      dateYmd: '2026-08-26',
      timezone: 'America/Mexico_City',
      buckets,
      now: new Date('2026-08-27T12:00:00.000Z'),
    });

    assert.equal(resolved.tempC, 23.9);
    assert.equal(resolved.winningIdx, 1);
    assert.equal(resolved.requiresManualReview, true);
    assert.equal(resolved.resolverInfo.weatherAudit.observedBucketIndex, 1);
    assert.ok(resolved.resolverInfo.weatherAudit.mismatchedBucketModels.includes('icon_seamless'));
    assert.ok(calls.some(url => url.includes('archive-api.open-meteo.com') && url.includes('models=best_match')));
    assert.ok(calls.some(url => url.includes('api.open-meteo.com')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('weather model audit stays automatic when forecast and archive land in same bucket', () => {
  const buckets = adaptiveBuckets(23.9);
  const audit = buildWeatherModelAudit({
    observedMaxC: 23.7,
    forecastAudit: {
      valuesByModel: {
        best_match: 23.9,
        gfs_seamless: 23.8,
        ecmwf_ifs025: 23.4,
        icon_seamless: 24.1,
      },
    },
    buckets,
  });

  assert.equal(audit.observedBucketIndex, 1);
  assert.equal(audit.requiresManualReview, false);
});
