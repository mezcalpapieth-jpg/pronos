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

test('buildSeriesDetail infers missing game numbers by chronological order around explicit games', () => {
  const meta = {
    key: 'basketball-nba:2026:east-semifinals:5-8',
    leaguePath: 'basketball/nba',
    league: 'nba',
    sport: 'nba',
    gameNumber: 6,
    bestOf: 7,
    winTarget: 4,
    guaranteedGames: 4,
    round: 'East Semifinals',
    seasonYear: 2026,
    homeTeam: { id: '5', name: 'Detroit Pistons', shortName: 'Pistons', abbreviation: 'DET' },
    awayTeam: { id: '8', name: 'Cleveland Cavaliers', shortName: 'Cavaliers', abbreviation: 'CLE' },
    teams: [
      { id: '5', name: 'Detroit Pistons', shortName: 'Pistons', abbreviation: 'DET' },
      { id: '8', name: 'Cleveland Cavaliers', shortName: 'Cavaliers', abbreviation: 'CLE' },
    ],
  };
  const outcomes = ['Detroit Pistons', 'Cleveland Cavaliers'];
  const markets = [
    { id: 201, status: 'resolved', outcome: 1, outcomes, startTime: '2026-05-05T23:00:00Z', seriesMeta: { ...meta, gameNumber: null } },
    { id: 202, status: 'resolved', outcome: 1, outcomes, startTime: '2026-05-07T23:00:00Z', seriesMeta: { ...meta, gameNumber: null } },
    { id: 203, status: 'resolved', outcome: 0, outcomes, startTime: '2026-05-09T19:00:00Z', seriesMeta: { ...meta, gameNumber: null } },
    { id: 204, status: 'resolved', outcome: 0, outcomes, startTime: '2026-05-12T00:00:00Z', seriesMeta: { ...meta, gameNumber: null } },
    { id: 205, status: 'resolved', outcome: 1, outcomes, startTime: '2026-05-14T00:00:00Z', seriesMeta: { ...meta, gameNumber: null } },
    { id: 206, status: 'resolved', outcome: 0, outcomes, startTime: '2026-05-15T23:00:00Z', seriesMeta: { ...meta, gameNumber: 6 } },
    { id: 207, status: 'active', outcome: null, outcomes, startTime: '2026-05-18T00:00:00Z', seriesMeta: { ...meta, gameNumber: 7 } },
  ];

  const detail = buildSeriesDetail(meta, markets);

  assert.deepEqual(detail.sequence.map(g => [g.gameNumber, g.id, g.status]), [
    [1, 201, 'resolved'],
    [2, 202, 'resolved'],
    [3, 203, 'resolved'],
    [4, 204, 'resolved'],
    [5, 205, 'resolved'],
    [6, 206, 'resolved'],
    [7, 207, 'active'],
  ]);
});

test('buildSeriesDetail uses ESPN series wins to keep missing prior games from looking pending', () => {
  const meta = {
    key: 'basketball-nba:2026:east-semifinals:5-8',
    leaguePath: 'basketball/nba',
    league: 'nba',
    sport: 'nba',
    gameNumber: 7,
    bestOf: 7,
    winTarget: 4,
    guaranteedGames: 4,
    round: 'East Semifinals',
    seasonYear: 2026,
    homeTeam: { id: '5', name: 'Detroit Pistons', shortName: 'Pistons', abbreviation: 'DET' },
    awayTeam: { id: '8', name: 'Cleveland Cavaliers', shortName: 'Cavaliers', abbreviation: 'CLE' },
    teams: [
      { id: '5', name: 'Detroit Pistons', shortName: 'Pistons', abbreviation: 'DET' },
      { id: '8', name: 'Cleveland Cavaliers', shortName: 'Cavaliers', abbreviation: 'CLE' },
    ],
    espnSeriesWins: { homeWins: 3, awayWins: 3 },
  };

  const detail = buildSeriesDetail(meta, [
    {
      id: 207,
      question: 'Game 7',
      status: 'active',
      outcome: null,
      outcomes: ['Detroit Pistons', 'Cleveland Cavaliers'],
      startTime: '2026-05-18T00:00:00Z',
      seriesMeta: meta,
    },
  ]);

  assert.equal(detail.summary, 'Series tied 3-3');
  assert.deepEqual(detail.sequence.map(g => [g.gameNumber, g.id, g.status, g.placeholder]), [
    [1, null, 'resolved', true],
    [2, null, 'resolved', true],
    [3, null, 'resolved', true],
    [4, null, 'resolved', true],
    [5, null, 'resolved', true],
    [6, null, 'resolved', true],
    [7, 207, 'active', false],
  ]);
});
