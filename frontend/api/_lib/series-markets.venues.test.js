import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildSeriesDetail, seriesMetaForGame, seriesTradeLockFromRows } from './series-markets.js';
import { formatSeriesSubtitle } from '../../app/src/lib/seriesDisplay.js';

const dodgers = { id: '19', name: 'Los Angeles Dodgers', shortName: 'Dodgers', abbreviation: 'LAD' };
const brewers = { id: '8', name: 'Milwaukee Brewers', shortName: 'Brewers', abbreviation: 'MIL' };

function gameMeta(gameNumber, homeTeam, awayTeam, homeWins, awayWins) {
  return {
    key: 'baseball-mlb:2026:series:19-8',
    leaguePath: 'baseball/mlb',
    league: 'mlb',
    sport: 'baseball',
    bestOf: 7,
    winTarget: 4,
    guaranteedGames: 4,
    seasonYear: 2026,
    gameNumber,
    homeTeam,
    awayTeam,
    teams: [homeTeam, awayTeam],
    espnSeriesWins: { homeWins, awayWins },
  };
}

test('per-game metadata preserves venue identities without changing the canonical series key', () => {
  const current = gameMeta(3, dodgers, brewers, 0, 2);
  const future = { ...gameMeta(6, brewers, dodgers, 2, 0), key: 'provider-round-alias' };

  const meta = seriesMetaForGame(current, future);

  assert.equal(meta.key, current.key);
  assert.equal(meta.gameNumber, 6);
  assert.deepEqual(meta.homeTeam, brewers);
  assert.deepEqual(meta.awayTeam, dodgers);
  assert.deepEqual(meta.teams, [brewers, dodgers]);
  assert.deepEqual(meta.espnSeriesWins, { homeWins: 2, awayWins: 0 });
  assert.deepEqual(current.teams, [dodgers, brewers]);
  assert.equal(future.key, 'provider-round-alias');
});

test('a game without an official score never borrows another venue\'s score', () => {
  const current = gameMeta(3, dodgers, brewers, 0, 2);
  const future = { ...gameMeta(6, brewers, dodgers, 2, 0), espnSeriesWins: null };

  const meta = seriesMetaForGame(current, future);

  assert.deepEqual(meta.teams, [brewers, dodgers]);
  assert.equal(meta.espnSeriesWins, null);
});

test('missing per-game metadata keeps fallback team identities and wins paired', () => {
  const current = gameMeta(3, dodgers, brewers, 0, 2);

  const meta = seriesMetaForGame(current, null);

  assert.deepEqual(meta.teams, [dodgers, brewers]);
  assert.deepEqual(meta.espnSeriesWins, { homeWins: 0, awayWins: 2 });
  assert.equal(meta.gameNumber, null);
});

for (const currentGame of [3, 6]) {
  test(`Brewers lead stays correct from game ${currentGame}'s venue, including pending games`, () => {
    const games = Array.from({ length: 7 }, (_, index) => {
      const gameNumber = index + 1;
      const milwaukeeHome = gameNumber <= 2 || gameNumber >= 6;
      const home = milwaukeeHome ? brewers : dodgers;
      const away = milwaukeeHome ? dodgers : brewers;
      const wins = Math.min(2, index);
      return {
        id: [343777, 346656, 352439][index] || null,
        status: gameNumber <= 2 ? 'resolved' : gameNumber === 3 ? 'active' : 'pending',
        outcome: gameNumber <= 2 ? 0 : null,
        outcomes: [home.name, away.name],
        seriesMeta: gameMeta(gameNumber, home, away, milwaukeeHome ? wins : 0, milwaukeeHome ? 0 : wins),
      };
    });
    const currentMeta = games[currentGame - 1].seriesMeta;
    const summaries = games.map(game => ({
      ...game,
      seriesMeta: seriesMetaForGame(currentMeta, game.seriesMeta),
    }));

    const detail = buildSeriesDetail(currentMeta, summaries);

    assert.equal(detail.teamAWins, currentGame === 3 ? 0 : 2);
    assert.equal(detail.teamBWins, currentGame === 3 ? 2 : 0);
    assert.equal(detail.summary, 'Brewers lidera 2-0');
    assert.equal(formatSeriesSubtitle(detail), `Juego ${currentGame} · Brewers lidera 2-0`);
    assert.ok(detail.sequence.every(game => game.summary === 'Brewers lidera 2-0'));
    assert.deepEqual(detail.sequence.slice(4).map(game => [game.status, game.seriesLocked]), [
      ['pending', true],
      ['pending', true],
      ['pending', true],
    ]);
  });
}

test('series trade gates keep series wins attached to teams when the venue changes', () => {
  const currentMeta = gameMeta(5, dodgers, brewers, 0, 2);
  const current = {
    id: 5,
    question: 'Milwaukee Brewers @ Los Angeles Dodgers - Game 5',
    outcomes: [dodgers.name, brewers.name],
    status: 'active',
    resolver_config: { source: 'espn', leaguePath: 'baseball/mlb', series: currentMeta },
  };
  const future = {
    id: 6,
    question: 'Los Angeles Dodgers @ Milwaukee Brewers - Game 6',
    outcomes: [brewers.name, dodgers.name],
    status: 'active',
    resolver_config: {
      source: 'espn',
      leaguePath: 'baseball/mlb',
      series: gameMeta(6, brewers, dodgers, 2, 0),
    },
  };

  const gate = seriesTradeLockFromRows(current, [current, future]);

  assert.equal(gate.locked, true);
  assert.equal(gate.status, 'pending');
  assert.equal(gate.summary, 'Brewers lidera 2-0');
});

for (const scope of ['points', 'protocol']) {
  test(`${scope} approved and pending detail rows use venue-safe series metadata`, async () => {
    const source = await readFile(new URL(`../${scope}/market.js`, import.meta.url), 'utf8');

    assert.match(source, /seriesMetaForGame,/);
    assert.equal(source.match(/seriesMeta: seriesMetaForGame\(fallbackMeta, resolvedMeta\)/g)?.length, 2);
    assert.doesNotMatch(source, /espnSeriesWins: resolvedMeta\?\.espnSeriesWins \|\| fallbackMeta/);
  });
}
