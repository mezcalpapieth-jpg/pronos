import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './team-standings.js';

test('team standings maps domestic soccer leagues to football-data competitions', () => {
  assert.equal(_internal.competitionCodeForProfile({ sport: 'soccer', league: 'Premier League' }), 'PL');
  assert.equal(_internal.competitionCodeForProfile({ sport: 'soccer', league: 'La Liga' }), 'PD');
  assert.equal(_internal.competitionCodeForProfile({ sport: 'soccer', league: 'MLS' }), null);
  assert.equal(_internal.competitionCodeForProfile({ sport: 'basketball', league: 'NBA' }), null);
});

test('team standings maps ESPN-only soccer leagues to ESPN standings paths', () => {
  assert.equal(_internal.espnStandingsPathForProfile({
    sport: 'soccer',
    league: 'Liga MX',
    espnLeaguePath: 'soccer/mex.1',
  }), 'soccer/mex.1');
  assert.equal(_internal.espnStandingsPathForProfile({
    sport: 'soccer',
    league: 'MLS',
    espnLeaguePath: 'soccer/usa.1',
  }), 'soccer/usa.1');
  assert.equal(_internal.espnStandingsPathForProfile({
    sport: 'soccer',
    league: 'Premier League',
    espnLeaguePath: 'soccer/eng.1',
  }), null);
});

test('team standings normalizes football-data tables and highlights the profile team', () => {
  const table = _internal.normalizeFootballDataStandings({
    competition: { code: 'PL', name: 'Premier League' },
    season: { id: 2026, currentMatchday: 18 },
    standings: [
      { type: 'HOME', table: [{ position: 1, team: { id: 1, name: 'Home Only' }, points: 9 }] },
      {
        type: 'TOTAL',
        table: [
          {
            position: 1,
            team: {
              id: 57,
              name: 'Arsenal FC',
              shortName: 'Arsenal',
              crest: 'arsenal.png',
            },
            playedGames: 18,
            won: 13,
            draw: 3,
            lost: 2,
            points: 42,
            goalsFor: 40,
            goalsAgainst: 16,
            goalDifference: 24,
          },
          {
            position: 2,
            team: {
              id: 65,
              name: 'Manchester City FC',
              shortName: 'Man City',
            },
            playedGames: 18,
            won: 12,
            draw: 4,
            lost: 2,
            points: 40,
            goalsFor: 38,
            goalsAgainst: 17,
            goalDifference: 21,
          },
        ],
      },
    ],
  }, {
    slug: 'arsenal',
    name: 'Arsenal',
    aliases: ['Arsenal FC'],
    footballDataId: 57,
  });

  assert.equal(table.league.code, 'PL');
  assert.equal(table.season.currentMatchday, 18);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[0], {
    position: 1,
    teamId: '57',
    teamName: 'Arsenal',
    logoUrl: 'arsenal.png',
    played: 18,
    won: 13,
    draw: 3,
    lost: 2,
    points: 42,
    goalsFor: 40,
    goalsAgainst: 16,
    goalDifference: 24,
    highlighted: true,
  });
  assert.equal(table.rows[1].highlighted, false);
});

test('team standings highlights directory teams without football-data ids by aliases', () => {
  const table = _internal.normalizeFootballDataStandings({
    competition: { code: 'PL', name: 'Premier League' },
    standings: [{
      type: 'TOTAL',
      table: [{
        position: 5,
        team: {
          id: 397,
          name: 'Brighton & Hove Albion FC',
          shortName: 'Brighton Hove',
        },
        playedGames: 12,
        points: 20,
      }],
    }],
  }, {
    slug: 'brighton',
    name: 'Brighton & Hove Albion',
    aliases: ['Brighton and Hove Albion', 'BHA'],
  });

  assert.equal(table.rows[0].highlighted, true);
});

test('team standings normalizes ESPN grouped standings and picks the profile team group', () => {
  const table = _internal.normalizeEspnStandings({
    name: 'MLS',
    abbreviation: 'MLS',
    children: [
      {
        name: 'Eastern Conference',
        standings: {
          season: 2026,
          seasonDisplayName: '2026 MLS',
          entries: [{
            team: {
              id: '182',
              displayName: 'Chicago Fire FC',
              shortDisplayName: 'Chicago',
              logos: [{ href: 'chicago.png' }],
            },
            stats: [
              { name: 'rank', value: 4, displayValue: '4' },
              { name: 'gamesPlayed', value: 13, displayValue: '13' },
              { name: 'wins', value: 7, displayValue: '7' },
              { name: 'ties', value: 2, displayValue: '2' },
              { name: 'losses', value: 4, displayValue: '4' },
              { name: 'points', value: 23, displayValue: '23' },
              { name: 'pointsFor', value: 25, displayValue: '25' },
              { name: 'pointsAgainst', value: 15, displayValue: '15' },
              { name: 'pointDifferential', value: 10, displayValue: '+10' },
            ],
          }],
        },
      },
      {
        name: 'Western Conference',
        standings: {
          season: 2026,
          seasonDisplayName: '2026 MLS',
          entries: [{
            team: {
              id: '187',
              displayName: 'LA Galaxy',
              shortDisplayName: 'LA Galaxy',
              logos: [{ href: 'galaxy.png' }],
            },
            stats: [
              { name: 'rank', value: 3, displayValue: '3' },
              { name: 'gamesPlayed', value: 13, displayValue: '13' },
              { name: 'wins', value: 8, displayValue: '8' },
              { name: 'ties', value: 1, displayValue: '1' },
              { name: 'losses', value: 4, displayValue: '4' },
              { name: 'points', value: 25, displayValue: '25' },
              { name: 'pointsFor', value: 21, displayValue: '21' },
              { name: 'pointsAgainst', value: 12, displayValue: '12' },
              { name: 'pointDifferential', value: 9, displayValue: '+9' },
            ],
          }],
        },
      },
    ],
  }, {
    sport: 'soccer',
    league: 'MLS',
    slug: 'la-galaxy',
    name: 'LA Galaxy',
    aliases: ['Los Angeles Galaxy'],
    espnTeamId: 187,
  });

  assert.equal(table.league.name, 'MLS · Conferencia Oeste');
  assert.equal(table.season.id, 2026);
  assert.equal(table.rows.length, 1);
  assert.deepEqual(table.rows[0], {
    position: 3,
    teamId: '187',
    teamName: 'LA Galaxy',
    logoUrl: 'galaxy.png',
    played: 13,
    won: 8,
    draw: 1,
    lost: 4,
    points: 25,
    goalsFor: 21,
    goalsAgainst: 12,
    goalDifference: 9,
    highlighted: true,
  });
});
