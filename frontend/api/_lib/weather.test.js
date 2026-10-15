import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptiveBuckets,
  buildWeatherModelAudit,
  fetchForecastModelMaxTempsC,
  fetchObservedMaxTempC,
  isWeatherArchiveDateComplete,
  resolveObservedWeatherMaxTempC,
  weatherBucketIndexFor,
  weatherResolutionCriteriaForBuckets,
} from './weather.js';

function archivePayload({ dateYmd = '2026-10-14', maxC = 24.1 } = {}) {
  return {
    daily: { temperature_2m_max: [maxC] },
    hourly: {
      time: Array.from({ length: 24 }, (_, hour) =>
        `${dateYmd}T${String(hour).padStart(2, '0')}:00`),
      temperature_2m: Array.from({ length: 24 }, (_, hour) => hour === 14 ? maxC : 15),
    },
  };
}

async function withWeatherResponse(payload, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => payload });
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function readArchive() {
  return fetchObservedMaxTempC({
    lat: 19.4326,
    lng: -99.1332,
    dateYmd: '2026-10-14',
    timezone: 'America/Mexico_City',
    now: new Date('2026-10-15T15:00:00.000Z'),
  });
}

test('archive-only policy resolves without consulting conflicting or unavailable forecasts', async () => {
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    requests++;
    assert.match(String(url), /archive-api/);
    return { ok: true, json: async () => archivePayload() };
  };
  try {
    const result = await resolveObservedWeatherMaxTempC({
      lat: 19.4326, lng: -99.1332, dateYmd: '2026-10-14', buckets: adaptiveBuckets(23.5),
      modelAuditPolicy: 'archive-only', now: new Date('2026-10-15T15:00:00Z'),
    });
    assert.equal(result.winningIdx, 2);
    assert.equal(result.requiresManualReview, false);
    assert.equal(result.tempC, 24.1);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy agreement policy does not silently pay when the forecast audit is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (!String(url).includes('archive-api')) throw new Error('forecast unavailable');
    return { ok: true, json: async () => archivePayload() };
  };
  try {
    const result = await resolveObservedWeatherMaxTempC({
      lat: 19.4326, lng: -99.1332, dateYmd: '2026-10-14', buckets: adaptiveBuckets(23.5),
      now: new Date('2026-10-15T15:00:00Z'),
    });
    assert.equal(result.requiresManualReview, true);
  } finally { globalThis.fetch = originalFetch; }
});

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

test('weather archive rejects missing or invalid hourly temperatures instead of treating them as zero', async () => {
  for (const missing of [null, undefined, '', ' ', false, NaN, Infinity]) {
    const payload = archivePayload();
    payload.hourly.temperature_2m[14] = missing;
    await withWeatherResponse(payload, async () => {
      await assert.rejects(readArchive(), error =>
        error.message === 'weather_archive_hourly_incomplete' && error.benign === true);
    });
  }

  const payload = archivePayload();
  payload.hourly.temperature_2m.fill(null);
  payload.daily.temperature_2m_max = [null];
  await withWeatherResponse(payload, async () => {
    await assert.rejects(readArchive(), /weather_archive_hourly_incomplete/);
  });
});

test('weather archive requires every hour of the requested date exactly once', async () => {
  const wrongDay = archivePayload({ dateYmd: '2026-10-13' });
  const duplicate = archivePayload();
  duplicate.hourly.time[23] = duplicate.hourly.time[22];
  const truncated = archivePayload();
  truncated.hourly.time.pop();
  truncated.hourly.temperature_2m.pop();
  const missingTemperatures = archivePayload();
  missingTemperatures.hourly.temperature_2m.pop();

  for (const payload of [wrongDay, duplicate, truncated, missingTemperatures]) {
    await withWeatherResponse(payload, async () => {
      await assert.rejects(readArchive(), error =>
        error.message === 'weather_archive_hourly_incomplete' && error.benign === true);
    });
  }
});

test('weather archive uses the complete hourly maximum when the daily summary is missing', async () => {
  const payload = archivePayload();
  payload.daily.temperature_2m_max = [null];
  await withWeatherResponse(payload, async () => {
    const observed = await readArchive();
    assert.equal(observed.maxC, 24.1);
    assert.equal(observed.dailyMaxC, null);
    assert.deepEqual(observed.peakHours, ['2026-10-14T14:00']);
  });
});

test('weather archive defers contradictory daily and hourly maxima', async () => {
  const payload = archivePayload();
  payload.daily.temperature_2m_max = [26.1];
  await withWeatherResponse(payload, async () => {
    await assert.rejects(readArchive(), error =>
      error.message === 'weather_archive_daily_hourly_mismatch'
      && error.benign === true
      && error.info.dailyMaxC === 26.1
      && error.info.hourlyMaxC === 24.1);
  });
});

test('weather readings accept a genuine zero but do not assign missing values to a bucket', async () => {
  const payload = archivePayload({ maxC: 0 });
  payload.hourly.temperature_2m.fill(-2);
  payload.hourly.temperature_2m[14] = 0;
  await withWeatherResponse(payload, async () => {
    const observed = await readArchive();
    assert.equal(observed.maxC, 0);
  });
  assert.equal(weatherBucketIndexFor(0, adaptiveBuckets(23)), 0);
  for (const missing of [null, undefined, '', false]) {
    assert.equal(weatherBucketIndexFor(missing, adaptiveBuckets(23)), -1);
  }
});

test('forecast probing rejects an entirely missing model response', async () => {
  await withWeatherResponse({ daily: { temperature_2m_max_best_match: [null] } }, async () => {
    await assert.rejects(fetchForecastModelMaxTempsC({
      lat: 19.4326,
      lng: -99.1332,
      dateYmd: '2026-10-14',
    }), /missing temp for 2026-10-14/);
  });
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
