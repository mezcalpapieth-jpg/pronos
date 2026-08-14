import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeTeamDirectoryLogos, sortTeamsForDirectory } from './teamDirectory.js';

test('team directory Todos sorts alphabetically across sports and leagues', () => {
  const sorted = sortTeamsForDirectory([
    { name: 'Zacatecas', sport: 'baseball', league: 'LMB' },
    { name: 'Arsenal', sport: 'soccer', league: 'Premier League' },
    { name: 'Bayern Munich', sport: 'soccer', league: 'Bundesliga' },
    { name: 'Diablos Rojos del México', sport: 'baseball', league: 'LMB' },
  ], 'all');

  assert.deepEqual(sorted.map(team => team.name), [
    'Arsenal',
    'Bayern Munich',
    'Diablos Rojos del México',
    'Zacatecas',
  ]);
});

test('team directory sport filters can still group by league before name', () => {
  const sorted = sortTeamsForDirectory([
    { name: 'Yankees', sport: 'baseball', league: 'MLB' },
    { name: 'Acereros de Monclova', sport: 'baseball', league: 'LMB' },
    { name: 'Dodgers', sport: 'baseball', league: 'MLB' },
  ], 'baseball');

  assert.deepEqual(sorted.map(team => `${team.league}:${team.name}`), [
    'LMB:Acereros de Monclova',
    'MLB:Dodgers',
    'MLB:Yankees',
  ]);
});

test('team directory merges resolved logos for teams missing static logos', () => {
  const teams = mergeTeamDirectoryLogos([
    { name: 'Bournemouth', slug: 'bournemouth', sport: 'soccer', league: 'Premier League' },
    { name: 'Acereros de Monclova', slug: 'acereros-de-monclova', sport: 'baseball', league: 'LMB' },
    { name: 'Los Angeles Lakers', slug: 'los-angeles-lakers', sport: 'basketball', league: 'NBA', logoUrl: 'static-lakers.png' },
  ], {
    'soccer:bournemouth': 'resolved-bournemouth.png',
    'baseball:acereros-de-monclova': 'resolved-acereros.png',
    'basketball:los-angeles-lakers': 'resolved-lakers.png',
  });

  assert.equal(teams[0].logoUrl, 'resolved-bournemouth.png');
  assert.equal(teams[1].logoUrl, 'resolved-acereros.png');
  assert.equal(teams[2].logoUrl, 'static-lakers.png');
});
