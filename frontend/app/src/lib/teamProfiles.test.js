import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEAM_PROFILES,
  findTeamByName,
  findTeamProfile,
  marketSportToTeamSport,
  teamProfilePath,
} from './teamProfiles.js';

test('team profiles resolve Arsenal from soccer market labels', () => {
  const team = findTeamByName('soccer', 'Arsenal');

  assert.equal(team?.slug, 'arsenal');
  assert.equal(teamProfilePath(team), '/teams/soccer/arsenal');
});

test('team profiles normalize market sports to profile sports', () => {
  assert.equal(marketSportToTeamSport('nba'), 'basketball');
  assert.equal(marketSportToTeamSport('baseball'), 'baseball');
  assert.equal(marketSportToTeamSport('lmb'), 'baseball');
  assert.equal(marketSportToTeamSport('lmp'), 'baseball');
  assert.equal(marketSportToTeamSport('nfl'), 'nfl');
});

test('team profiles expose examples across supported sports', () => {
  assert.equal(findTeamProfile('basketball', 'san-antonio-spurs')?.name, 'San Antonio Spurs');
  assert.equal(findTeamProfile('baseball', 'los-angeles-dodgers')?.name, 'Los Angeles Dodgers');
  assert.equal(findTeamProfile('nfl', 'kansas-city-chiefs')?.name, 'Kansas City Chiefs');
});

test('team profiles include Europa and Conference League finalists', () => {
  assert.equal(findTeamByName('soccer', 'Freiburg')?.slug, 'freiburg');
  assert.equal(findTeamByName('soccer', 'Aston Villa FC')?.slug, 'aston-villa');
  assert.equal(findTeamByName('soccer', 'Crystal Palace')?.slug, 'crystal-palace');
  assert.equal(findTeamByName('soccer', 'Rayo Vallecano de Madrid')?.slug, 'rayo-vallecano');
});

test('team profiles include full top soccer league directories', () => {
  const soccerTeams = TEAM_PROFILES.filter(team => team.sport === 'soccer');
  const countLeague = league => soccerTeams.filter(team => team.league === league).length;

  assert.equal(countLeague('Bundesliga'), 18);
  assert.equal(countLeague('Premier League'), 20);
  assert.equal(countLeague('La Liga'), 20);
  assert.equal(countLeague('Serie A'), 20);
  assert.equal(countLeague('Liga MX'), 18);
});

test('soccer team profiles include ESPN league paths for schedule lookup', () => {
  assert.equal(findTeamProfile('soccer', 'cruz-azul')?.espnLeaguePath, 'soccer/mex.1');
  assert.equal(findTeamProfile('soccer', 'pumas-unam')?.espnLeaguePath, 'soccer/mex.1');
  assert.equal(findTeamProfile('soccer', 'arsenal')?.espnLeaguePath, 'soccer/eng.1');
});

test('Liga MX team profiles include ESPN logos for directory cards', () => {
  assert.equal(findTeamProfile('soccer', 'cruz-azul')?.logoUrl, 'https://a.espncdn.com/i/teamlogos/soccer/500/218.png');
  assert.equal(findTeamProfile('soccer', 'pumas-unam')?.logoUrl, 'https://a.espncdn.com/i/teamlogos/soccer/500/233.png');
});

test('team profiles include Mexican summer and winter baseball leagues', () => {
  const baseballTeams = TEAM_PROFILES.filter(team => team.sport === 'baseball');
  const countLeague = league => baseballTeams.filter(team => team.league === league).length;

  assert.equal(countLeague('LMB'), 20);
  assert.equal(countLeague('LMP'), 10);
  assert.equal(findTeamByName('lmp', 'Tomateros de Culiacán')?.slug, 'tomateros-de-culiacan');
  assert.equal(findTeamByName('lmb', 'Diablos Rojos del México')?.slug, 'diablos-rojos-del-mexico');
});
