import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFootballDataEspnFallbackConfig } from './sports-resolver-fallback.js';

test('football-data soccer markets can fall back to ESPN by competition and teams', () => {
  const fallback = buildFootballDataEspnFallbackConfig({
    resolverConfig: {
      source: 'football-data',
      matchId: 557092,
      shape: 'draw3',
    },
    sourceData: {
      competitionCode: 'CLI',
      kickoffUtc: '2026-05-21T00:30:00Z',
      home: { name: 'Flamengo' },
      away: { name: 'Estudiantes LP' },
    },
    sport: 'soccer',
    league: 'copa-libertadores',
    startTime: '2026-05-21T00:30:00.000Z',
  });

  assert.deepEqual(fallback, {
    source: 'espn',
    leaguePath: 'soccer/conmebol.libertadores',
    eventId: null,
    dateYmd: '2026-05-21',
    homeName: 'Flamengo',
    awayName: 'Estudiantes LP',
    shape: 'draw3',
    originalSource: 'football-data',
    originalMatchId: '557092',
  });
});

test('non football-data sports configs do not build fallback configs', () => {
  const fallback = buildFootballDataEspnFallbackConfig({
    resolverConfig: { source: 'espn', leaguePath: 'soccer/mex.1', shape: 'draw3' },
    sourceData: {},
    sport: 'soccer',
    league: 'liga-mx',
  });

  assert.equal(fallback, null);
});
