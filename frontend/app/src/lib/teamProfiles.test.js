import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
  assert.equal(marketSportToTeamSport('nfl'), 'nfl');
});

test('team profiles expose examples across supported sports', () => {
  assert.equal(findTeamProfile('basketball', 'san-antonio-spurs')?.name, 'San Antonio Spurs');
  assert.equal(findTeamProfile('baseball', 'los-angeles-dodgers')?.name, 'Los Angeles Dodgers');
  assert.equal(findTeamProfile('nfl', 'kansas-city-chiefs')?.name, 'Kansas City Chiefs');
});
