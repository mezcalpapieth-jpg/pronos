import test from 'node:test';
import assert from 'node:assert/strict';
import { extractDateYmdFromQuestion, syncWeatherDateFromMarket } from './weather-market-sync.js';

test('weather market sync extracts Spanish slash dates from question', () => {
  assert.equal(
    extractDateYmdFromQuestion('¿Temperatura máxima en CDMX el 26/08/2026?'),
    '2026-08-26',
  );
});

test('weather market sync updates forecastDateYmd from edited question', () => {
  const result = syncWeatherDateFromMarket({
    question: '¿Temperatura máxima en CDMX el 26/08/2026?',
    endTime: '2026-08-27T06:00:00.000Z',
    resolverConfig: {
      source: 'open-meteo',
      lat: 19.4326,
      lng: -99.1332,
      forecastDateYmd: '2026-08-27',
      buckets: ['24 o menos', '25-26', '27-28', '29 o mas'],
    },
    sourceData: { city: 'CDMX', forecastDateYmd: '2026-08-27' },
  });

  assert.equal(result.changed, true);
  assert.equal(result.forecastDateYmd, '2026-08-26');
  assert.equal(result.resolverConfig.forecastDateYmd, '2026-08-26');
  assert.equal(result.sourceData.forecastDateYmd, '2026-08-26');
});

test('weather market sync falls back to end time date when question has no date', () => {
  const result = syncWeatherDateFromMarket({
    question: '¿Temperatura máxima en CDMX?',
    endTime: '2026-08-26T23:59:00.000Z',
    resolverConfig: {
      source: 'open-meteo',
      forecastDateYmd: '2026-08-27',
      buckets: ['24 o menos', '25-26', '27-28', '29 o mas'],
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.forecastDateYmd, '2026-08-26');
});

test('weather market sync repairs stale source data when config already matches', () => {
  const result = syncWeatherDateFromMarket({
    question: '¿Temperatura máxima en CDMX el 26/08/2026?',
    endTime: '2026-08-26T23:59:00.000Z',
    resolverConfig: {
      source: 'open-meteo',
      forecastDateYmd: '2026-08-26',
      buckets: ['24 o menos', '25-26', '27-28', '29 o mas'],
    },
    sourceData: { city: 'CDMX', forecastDateYmd: '2026-08-27' },
  });

  assert.equal(result.changed, true);
  assert.equal(result.resolverConfig.forecastDateYmd, '2026-08-26');
  assert.equal(result.sourceData.forecastDateYmd, '2026-08-26');
});

test('weather market sync ignores non-weather resolvers', () => {
  const resolverConfig = { source: 'finnhub', threshold: 610, op: 'gt' };
  const result = syncWeatherDateFromMarket({
    question: '¿Temperatura máxima en CDMX el 26/08/2026?',
    endTime: '2026-08-26T23:59:00.000Z',
    resolverConfig,
  });

  assert.equal(result.changed, false);
  assert.equal(result.resolverConfig, resolverConfig);
});
