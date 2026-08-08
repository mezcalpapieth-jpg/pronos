import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOURNAMENT_QUALIFYING_MARKETS,
  tournamentRulesPayload,
} from './points-tournament-config.js';

test('points tournament requires ten qualifying markets', () => {
  assert.equal(TOURNAMENT_QUALIFYING_MARKETS, 10);
  assert.equal(tournamentRulesPayload().qualifyingMarkets, 10);
});
