import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOURNAMENT_QUALIFYING_MARKETS,
  TOURNAMENT_REWARDS,
  tournamentRulesPayload,
} from './points-tournament-config.js';

test('points tournament requires ten qualifying markets', () => {
  assert.equal(TOURNAMENT_QUALIFYING_MARKETS, 10);
  assert.equal(tournamentRulesPayload().qualifyingMarkets, 10);
});

test('points tournament social follow and post rewards are 100 MXNP', () => {
  assert.equal(TOURNAMENT_REWARDS.socialFollow, 100);
  assert.equal(TOURNAMENT_REWARDS.socialPost, 100);
});
