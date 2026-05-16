import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHAMPIONS_LEAGUE_FINAL,
  CHAMPIONS_LEAGUE_MARKET_GROUPS,
  CHAMPIONS_LEAGUE_NEXT_SEASON,
  CHAMPIONS_LEAGUE_ROAD,
  finalMarketOptions,
  findChampionsLeagueFinalMarket,
  findChampionsLeagueFinalMarkets,
  formatCountdown,
  isChampionsLeagueFinalWinnerMarket,
} from './championsLeague.js';

test('Champions League hub models the PSG vs Arsenal final countdown', () => {
  assert.equal(CHAMPIONS_LEAGUE_FINAL.home.shortName, 'PSG');
  assert.equal(CHAMPIONS_LEAGUE_FINAL.away.shortName, 'ARS');
  assert.equal(CHAMPIONS_LEAGUE_FINAL.kickoffIso, '2026-05-30T16:00:00.000Z');
  assert.match(CHAMPIONS_LEAGUE_FINAL.venue, /Budapest/);

  assert.deepEqual(
    formatCountdown('2026-05-30T16:00:00.000Z', '2026-05-29T14:28:03.000Z'),
    { days: 1, hours: 1, minutes: 31, seconds: 57, done: false },
  );
});

test('Champions League road keeps current markets closed and future season hidden', () => {
  assert.ok(CHAMPIONS_LEAGUE_ROAD.some(round => round.id === 'final'));
  assert.ok(CHAMPIONS_LEAGUE_ROAD.every(round => round.status === 'closed'));
  const finalGroup = CHAMPIONS_LEAGUE_MARKET_GROUPS.find(group => group.id === 'final-market');
  const finalWinner = finalGroup.markets.find(market => market.id === 'ucl-final-winner');
  assert.equal(finalWinner.status, 'open');
  assert.equal(CHAMPIONS_LEAGUE_NEXT_SEASON.enabled, false);
});

test('Champions League final market helper links the real PSG-Arsenal market without draw', () => {
  const markets = [
    {
      id: 12,
      question: 'Barcelona vs Real Madrid',
      sport: 'soccer',
      league: 'la-liga',
      outcomes: ['Barcelona', 'Empate', 'Real Madrid'],
      prices: [0.4, 0.25, 0.35],
    },
    {
      id: 33,
      question: 'PSG vs Arsenal',
      sport: 'soccer',
      league: 'uefa-cl',
      outcomes: ['PSG', 'Empate', 'Arsenal'],
      prices: [0.37, 0.27, 0.36],
      outcomeImages: ['psg.png', null, 'arsenal.png'],
      startTime: '2026-04-15T19:00:00.000Z',
    },
    {
      id: 34,
      question: 'PSG vs Arsenal',
      sport: 'soccer',
      league: 'uefa-cl',
      outcomes: ['PSG', 'Empate', 'Arsenal'],
      prices: [0.37, 0.27, 0.36],
      outcomeImages: ['psg.png', null, 'arsenal.png'],
      startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
    },
  ];

  const market = findChampionsLeagueFinalMarket(markets);
  assert.equal(market.id, 34);
  assert.deepEqual(
    finalMarketOptions(market).map(option => ({
      label: option.label,
      pct: option.pct,
      outcomeIndex: option.outcomeIndex,
      image: option.image,
    })),
    [
      { label: 'PSG', pct: 51, outcomeIndex: 0, image: 'psg.png' },
      { label: 'Arsenal', pct: 49, outcomeIndex: 2, image: 'arsenal.png' },
    ],
  );
});

test('Champions League final helper links the winner plus final side markets', () => {
  const markets = [
    {
      id: 34,
      question: 'PSG vs Arsenal',
      sport: 'soccer',
      league: 'uefa-cl',
      outcomes: ['PSG', 'Arsenal'],
      prices: [0.51, 0.49],
      startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
    },
    {
      id: 35,
      question: '¿La final tendrá más de 2.5 goles?',
      sport: 'soccer',
      league: 'uefa-cl',
      outcomes: ['Sí', 'No'],
      startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
    },
    {
      id: 36,
      question: '¿Un delantero gana el MVP de la final?',
      sport: 'soccer',
      league: 'uefa-cl',
      outcomes: ['Sí', 'No'],
      startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
    },
  ];

  assert.deepEqual(findChampionsLeagueFinalMarkets(markets), {
    winner: markets[0],
    goals: markets[1],
    mvp: markets[2],
  });
  assert.equal(findChampionsLeagueFinalMarket(markets), markets[0]);
});

test('Champions League final card predicate only matches the winner market', () => {
  const winner = {
    id: 34,
    question: 'PSG vs Arsenal',
    sport: 'soccer',
    league: 'uefa-cl',
    outcomes: ['PSG', 'Arsenal'],
    startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
  };
  const sideMarket = {
    id: 35,
    question: '¿La final tendrá más de 2.5 goles?',
    sport: 'soccer',
    league: 'uefa-cl',
    outcomes: ['Sí', 'No'],
    startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
  };
  const differentMatch = {
    id: 36,
    question: 'Barcelona vs Real Madrid',
    sport: 'soccer',
    league: 'uefa-cl',
    outcomes: ['Barcelona', 'Real Madrid'],
    startTime: CHAMPIONS_LEAGUE_FINAL.kickoffIso,
  };

  assert.equal(isChampionsLeagueFinalWinnerMarket(winner), true);
  assert.equal(isChampionsLeagueFinalWinnerMarket(sideMarket), false);
  assert.equal(isChampionsLeagueFinalWinnerMarket(differentMatch), false);
});
