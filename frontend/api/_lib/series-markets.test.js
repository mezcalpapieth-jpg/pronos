import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildSeriesDetail,
  extractEspnSeriesMeta,
  seriesScoreSummary,
  seriesSubtitle,
} from './series-markets.js';

const nbaEvent = {
  id: '401999001',
  name: 'Los Angeles Lakers at Oklahoma City Thunder - Game 4',
  shortName: 'LAL @ OKC',
  date: '2026-05-16T01:30:00Z',
  season: { year: 2026, type: 3 },
  competitions: [
    {
      notes: [{ headline: 'Western Conference Semifinals - Game 4' }],
      competitors: [
        {
          homeAway: 'home',
          team: {
            id: '25',
            displayName: 'Oklahoma City Thunder',
            shortDisplayName: 'Thunder',
            abbreviation: 'OKC',
          },
        },
        {
          homeAway: 'away',
          team: {
            id: '13',
            displayName: 'Los Angeles Lakers',
            shortDisplayName: 'Lakers',
            abbreviation: 'LAL',
          },
        },
      ],
      series: {
        summary: 'Game 4 of 7',
        name: 'Western Semifinals',
      },
    },
  ],
};

test('extractEspnSeriesMeta reads NBA playoff game number and best-of metadata', () => {
  const meta = extractEspnSeriesMeta(nbaEvent, {
    leaguePath: 'basketball/nba',
    league: 'nba',
    sport: 'nba',
  });

  assert.equal(meta.gameNumber, 4);
  assert.equal(meta.bestOf, 7);
  assert.equal(meta.winTarget, 4);
  assert.equal(meta.guaranteedGames, 4);
  assert.equal(meta.homeTeam.shortName, 'Thunder');
  assert.equal(meta.awayTeam.shortName, 'Lakers');
  assert.match(meta.key, /basketball-nba/);
});

test('seriesSubtitle includes game number and current series score summary', () => {
  assert.equal(seriesScoreSummary({
    teamAWins: 3,
    teamBWins: 0,
    teamAName: 'Thunder',
    teamBName: 'Lakers',
  }), 'Thunder lead 3-0');

  assert.equal(seriesSubtitle({
    gameNumber: 4,
    summary: 'Thunder lead 3-0',
  }), 'Game 4 · Thunder lead 3-0');
});

test('buildSeriesDetail adds conditional pending games until a best-of-seven series is clinched', () => {
  const meta = extractEspnSeriesMeta(nbaEvent, {
    leaguePath: 'basketball/nba',
    league: 'nba',
    sport: 'nba',
  });
  const markets = [
    {
      id: 10,
      question: 'G1',
      status: 'resolved',
      outcome: 0,
      outcomes: ['Oklahoma City Thunder', 'Los Angeles Lakers'],
      startTime: '2026-05-10T01:30:00Z',
      seriesMeta: { ...meta, gameNumber: 1 },
    },
    {
      id: 11,
      question: 'G2',
      status: 'resolved',
      outcome: 0,
      outcomes: ['Oklahoma City Thunder', 'Los Angeles Lakers'],
      startTime: '2026-05-12T01:30:00Z',
      seriesMeta: { ...meta, gameNumber: 2 },
    },
    {
      id: 12,
      question: 'G3',
      status: 'resolved',
      outcome: 0,
      outcomes: ['Oklahoma City Thunder', 'Los Angeles Lakers'],
      startTime: '2026-05-14T01:30:00Z',
      seriesMeta: { ...meta, gameNumber: 3 },
    },
    {
      id: 13,
      question: 'G4',
      status: 'active',
      outcome: null,
      outcomes: ['Oklahoma City Thunder', 'Los Angeles Lakers'],
      startTime: '2026-05-16T01:30:00Z',
      seriesMeta: meta,
    },
  ];

  const detail = buildSeriesDetail(meta, markets);

  assert.equal(detail.subtitle, 'Game 4 · Thunder lead 3-0');
  assert.deepEqual(detail.sequence.map(g => [g.gameNumber, g.id, g.status, g.placeholder]), [
    [1, 10, 'resolved', false],
    [2, 11, 'resolved', false],
    [3, 12, 'resolved', false],
    [4, 13, 'active', false],
    [5, null, 'pending', true],
    [6, null, 'pending', true],
    [7, null, 'pending', true],
  ]);
});

test('buildSeriesDetail marks remaining conditional games as not needed after clinch', () => {
  const meta = {
    key: 'baseball-mlb:2026:division:lad-sd',
    leaguePath: 'baseball/mlb',
    league: 'mlb',
    sport: 'baseball',
    gameNumber: 4,
    bestOf: 5,
    winTarget: 3,
    guaranteedGames: 3,
    homeTeam: { id: 'LAD', name: 'Los Angeles Dodgers', shortName: 'Dodgers', abbreviation: 'LAD' },
    awayTeam: { id: 'SD', name: 'San Diego Padres', shortName: 'Padres', abbreviation: 'SD' },
    teams: [
      { id: 'LAD', name: 'Los Angeles Dodgers', shortName: 'Dodgers', abbreviation: 'LAD' },
      { id: 'SD', name: 'San Diego Padres', shortName: 'Padres', abbreviation: 'SD' },
    ],
  };
  const markets = [
    { id: 20, status: 'resolved', outcome: 0, outcomes: ['Los Angeles Dodgers', 'San Diego Padres'], seriesMeta: { ...meta, gameNumber: 1 } },
    { id: 21, status: 'resolved', outcome: 0, outcomes: ['Los Angeles Dodgers', 'San Diego Padres'], seriesMeta: { ...meta, gameNumber: 2 } },
    { id: 22, status: 'resolved', outcome: 0, outcomes: ['Los Angeles Dodgers', 'San Diego Padres'], seriesMeta: { ...meta, gameNumber: 3 } },
  ];

  const detail = buildSeriesDetail(meta, markets);

  assert.equal(detail.summary, 'Dodgers lead 3-0');
  assert.deepEqual(detail.sequence.map(g => [g.gameNumber, g.status]), [
    [1, 'resolved'],
    [2, 'resolved'],
    [3, 'resolved'],
    [4, 'not_needed'],
    [5, 'not_needed'],
  ]);
});
