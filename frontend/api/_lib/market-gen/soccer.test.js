import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './soccer.js';

function soccerMatch({
  id = 100,
  stage = 'FINAL',
  homeShortName = 'PSG',
  awayShortName = 'Arsenal',
} = {}) {
  return {
    id,
    utcDate: '2026-05-30T16:00:00.000Z',
    stage,
    matchday: 17,
    competition: { name: 'UEFA Champions League' },
    homeTeam: {
      id: 524,
      name: 'Paris Saint-Germain FC',
      shortName: homeShortName,
      tla: 'PSG',
      crest: 'psg.png',
    },
    awayTeam: {
      id: 57,
      name: 'Arsenal FC',
      shortName: awayShortName,
      tla: 'ARS',
      crest: 'arsenal.png',
    },
  };
}

test('UEFA Champions League final generates a binary winner market with no draw', () => {
  const spec = _internal.matchToMarketSpec(soccerMatch(), 'CL');

  assert.equal(spec.question, 'PSG vs Arsenal');
  assert.deepEqual(spec.outcomes, ['PSG', 'Arsenal']);
  assert.deepEqual(spec.outcome_images, ['psg.png', 'arsenal.png']);
  assert.equal(spec.amm_mode, 'unified');
  assert.equal(spec.resolver_config.shape, 'binary');
});

test('non-final soccer matches keep the regular three-way draw market', () => {
  const spec = _internal.matchToMarketSpec(soccerMatch({ id: 101, stage: 'SEMI_FINALS' }), 'CL');

  assert.deepEqual(spec.outcomes, ['PSG', 'Empate', 'Arsenal']);
  assert.deepEqual(spec.outcome_images, ['psg.png', null, 'arsenal.png']);
  assert.equal(spec.resolver_config.shape, 'draw3');
});
