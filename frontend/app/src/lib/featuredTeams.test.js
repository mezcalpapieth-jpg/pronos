import test from 'node:test';
import assert from 'node:assert/strict';

import {
  featuredTeamKey,
  marketMatchesFeaturedTeam,
  prioritizeFeaturedMarkets,
} from './featuredTeams.js';
import { findTeamByName } from './teamProfiles.js';

test('featured teams match market outcomes by team profile key', () => {
  const arsenal = findTeamByName('soccer', 'Arsenal');
  const keys = [featuredTeamKey(arsenal)];
  const market = {
    id: 'm1',
    sport: 'soccer',
    outcomes: ['PSG', 'Arsenal'],
    trending: false,
  };

  assert.equal(marketMatchesFeaturedTeam(market, keys), true);
});

test('featured team markets are marked trending and sorted first', () => {
  const arsenal = findTeamByName('soccer', 'Arsenal');
  const rows = [
    { id: 'other', sport: 'soccer', outcomes: ['PSG', 'Real Madrid'], trending: false },
    { id: 'arsenal', sport: 'soccer', outcomes: ['PSG', 'Arsenal'], trending: false },
  ];

  const prioritized = prioritizeFeaturedMarkets(rows, [featuredTeamKey(arsenal)]);

  assert.equal(prioritized[0].id, 'arsenal');
  assert.equal(prioritized[0].trending, true);
  assert.equal(prioritized[0].userFeaturedTeam, true);
  assert.equal(prioritized[1].id, 'other');
});
