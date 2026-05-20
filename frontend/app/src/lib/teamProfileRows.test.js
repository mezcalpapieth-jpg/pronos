import test from 'node:test';
import assert from 'node:assert/strict';

import { logoForTeamInRows, marketOnlyRowForTeam } from './teamProfileRows.js';

test('market-only team rows skip soccer draw outcomes and keep team logos aligned', () => {
  const row = marketOnlyRowForTeam(
    { slug: 'cruz-azul', name: 'Cruz Azul', sport: 'soccer' },
    {
      id: 11,
      status: 'active',
      startTime: '2026-05-21T02:00:00.000Z',
      outcomes: ['Cruz Azul', 'Empate', 'Pumas UNAM'],
      outcomeImages: ['cruz.png', null, 'pumas.png'],
      sport: 'soccer',
    },
  );

  assert.equal(row.homeName, 'Cruz Azul');
  assert.equal(row.awayName, 'Pumas UNAM');
  assert.equal(row.homeLogo, 'cruz.png');
  assert.equal(row.awayLogo, 'pumas.png');
});

test('market-only team rows treat binary sports outcomes as home then away', () => {
  const row = marketOnlyRowForTeam(
    { slug: 'cleveland-cavaliers', name: 'Cleveland Cavaliers', sport: 'basketball' },
    {
      id: 12,
      status: 'active',
      outcomes: ['Cleveland Cavaliers', 'Detroit Pistons'],
      outcomeImages: ['cavs.png', 'pistons.png'],
      sport: 'basketball',
    },
  );

  assert.equal(row.homeName, 'Cleveland Cavaliers');
  assert.equal(row.awayName, 'Detroit Pistons');
  assert.equal(row.homeLogo, 'cavs.png');
  assert.equal(row.awayLogo, 'pistons.png');
});

test('team profile rows can infer the profile logo from attached schedule rows', () => {
  const logo = logoForTeamInRows(
    { slug: 'pumas-unam', name: 'Pumas UNAM', sport: 'soccer' },
    [{
      homeName: 'Cruz Azul',
      awayName: 'Pumas UNAM',
      homeLogo: 'cruz.png',
      awayLogo: 'pumas.png',
      sport: 'soccer',
    }],
  );

  assert.equal(logo, 'pumas.png');
});
