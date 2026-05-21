import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildEspnLiveScoreConfig,
  normalizeEspnLiveScore,
  readEspnLiveScore,
} from './espn-live-score.js';

test('normalizeEspnLiveScore returns basketball period scores and current clock', () => {
  const live = normalizeEspnLiveScore({
    leaguePath: 'basketball/nba',
    event: {
      id: '401871326',
      date: '2026-05-20T23:30:00Z',
      status: {
        period: 3,
        displayClock: '4:21',
        type: { state: 'in', completed: false, shortDetail: 'Q3 - 4:21' },
      },
      competitions: [{
        competitors: [
          {
            homeAway: 'home',
            score: '82',
            team: {
              displayName: 'Oklahoma City Thunder',
              shortDisplayName: 'Thunder',
              logo: 'https://a.espncdn.com/thunder.png',
            },
            linescores: [{ value: 25 }, { value: 23 }, { value: 34 }],
          },
          {
            homeAway: 'away',
            score: '79',
            team: {
              displayName: 'San Antonio Spurs',
              shortDisplayName: 'Spurs',
              logo: 'https://a.espncdn.com/spurs.png',
            },
            linescores: [{ value: 24 }, { value: 27 }, { value: 28 }],
          },
        ],
      }],
    },
  });

  assert.equal(live.source, 'espn');
  assert.equal(live.eventId, '401871326');
  assert.equal(live.state, 'in');
  assert.equal(live.completed, false);
  assert.equal(live.sport, 'basketball');
  assert.equal(live.statusLabel, '3C · 4:21');
  assert.deepEqual(live.home, {
    name: 'Thunder',
    score: 82,
    logo: 'https://a.espncdn.com/thunder.png',
  });
  assert.deepEqual(live.away, {
    name: 'Spurs',
    score: 79,
    logo: 'https://a.espncdn.com/spurs.png',
  });
  assert.deepEqual(live.periods, [
    { label: '1C', home: 25, away: 24 },
    { label: '2C', home: 23, away: 27 },
    { label: '3C', home: 34, away: 28 },
  ]);
});

test('normalizeEspnLiveScore keeps baseball inning linescores and total runs', () => {
  const live = normalizeEspnLiveScore({
    leaguePath: 'baseball/mlb',
    event: {
      id: '401696969',
      status: {
        period: 7,
        type: { state: 'in', completed: false, shortDetail: 'Bot 7th' },
      },
      competitions: [{
        competitors: [
          {
            homeAway: 'home',
            score: '5',
            team: { shortDisplayName: 'Yankees' },
            linescores: [0, 0, 2, 0, 1, 0, 2].map(value => ({ value })),
          },
          {
            homeAway: 'away',
            score: '3',
            team: { shortDisplayName: 'Red Sox' },
            linescores: [1, 0, 0, 0, 2, 0, null].map(value => ({ value })),
          },
        ],
      }],
    },
  });

  assert.equal(live.sport, 'baseball');
  assert.equal(live.statusLabel, 'Bot 7th');
  assert.equal(live.home.score, 5);
  assert.equal(live.away.score, 3);
  assert.deepEqual(live.periods.slice(0, 3), [
    { label: '1', home: 0, away: 1 },
    { label: '2', home: 0, away: 0 },
    { label: '3', home: 2, away: 0 },
  ]);
  assert.deepEqual(live.periods.at(-1), { label: '7', home: 2, away: null });
});

test('buildEspnLiveScoreConfig exposes only the safe ESPN event lookup fields', () => {
  const cfg = buildEspnLiveScoreConfig({
    resolverType: 'sports_api',
    resolverConfig: {
      source: 'espn',
      leaguePath: 'soccer/eng.1',
      eventId: '702304',
      dateYmd: '2026-05-20',
      shape: 'draw3',
      privateToken: 'never-expose-me',
    },
  });

  assert.deepEqual(cfg, {
    source: 'espn',
    leaguePath: 'soccer/eng.1',
    eventId: '702304',
    dateYmd: '2026-05-20',
  });
});

test('buildEspnLiveScoreConfig maps UEFA soccer metadata to an ESPN team lookup', () => {
  const cfg = buildEspnLiveScoreConfig({
    resolverType: null,
    resolverConfig: null,
    source: 'uefa.com',
    sourceEventId: 'uefa-2026-europa-final',
    sport: 'soccer',
    sourceData: {
      competitionCode: 'EL',
      kickoffUtc: '2026-05-20T19:00:00.000Z',
      home: { name: 'Freiburg' },
      away: { name: 'Aston Villa' },
    },
  });

  assert.deepEqual(cfg, {
    source: 'espn',
    leaguePath: 'soccer/uefa.europa',
    eventId: null,
    dateYmd: '2026-05-20',
    homeName: 'Freiburg',
    awayName: 'Aston Villa',
  });

  const premierLeagueCfg = buildEspnLiveScoreConfig({
    resolverType: 'sports_api',
    resolverConfig: { source: 'football-data', matchId: 44, shape: 'draw3' },
    sport: 'soccer',
    sourceData: {
      competitionCode: 'PL',
      kickoffUtc: '2026-05-20T19:00:00.000Z',
      home: { name: 'Arsenal' },
      away: { name: 'Aston Villa' },
    },
  });

  assert.equal(premierLeagueCfg.leaguePath, 'soccer/eng.1');
});

test('readEspnLiveScore can find a soccer event by teams when no event id is stored', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /soccer\/uefa\.europa\/scoreboard/);
    return {
      ok: true,
      json: async () => ({
        events: [{
          id: '401862911',
          date: '2026-05-20T19:00Z',
          status: {
            displayClock: '75:00',
            type: { state: 'in', completed: false, shortDetail: "75'" },
          },
          competitions: [{
            competitors: [
              { homeAway: 'home', score: '1', team: { shortDisplayName: 'Freiburg' } },
              { homeAway: 'away', score: '2', team: { shortDisplayName: 'Aston Villa' } },
            ],
          }],
        }],
      }),
    };
  };

  const live = await readEspnLiveScore({
    leaguePath: 'soccer/uefa.europa',
    eventId: null,
    dateYmd: '2026-05-20',
    homeName: 'SC Freiburg',
    awayName: 'Aston Villa FC',
  });

  assert.equal(live.eventId, '401862911');
  assert.equal(live.statusLabel, "75'");
  assert.equal(live.home.score, 1);
  assert.equal(live.away.score, 2);
});

test('readEspnLiveScore matches display names when ESPN short names are abbreviated', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  globalThis.fetch = async (url) => {
    assert.match(String(url), /soccer\/conmebol\.libertadores\/scoreboard/);
    return {
      ok: true,
      json: async () => ({
        events: [{
          id: '401865536',
          date: '2026-05-21T02:00Z',
          status: { type: { state: 'post', completed: true } },
          competitions: [{
            competitors: [
              {
                homeAway: 'home',
                score: '2',
                team: { displayName: 'Cusco FC', shortDisplayName: 'Cusco' },
              },
              {
                homeAway: 'away',
                score: '3',
                team: { displayName: 'Independiente Medellín', shortDisplayName: 'Ind. Medellín' },
              },
            ],
          }],
        }],
      }),
    };
  };

  const live = await readEspnLiveScore({
    leaguePath: 'soccer/conmebol.libertadores',
    eventId: null,
    dateYmd: '2026-05-21',
    homeName: 'Cusco',
    awayName: 'Independiente',
  });

  assert.equal(live.eventId, '401865536');
  assert.equal(live.completed, true);
  assert.equal(live.home.score, 2);
  assert.equal(live.away.score, 3);
});
