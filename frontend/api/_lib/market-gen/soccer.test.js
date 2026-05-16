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

test('UEFA Champions League final also generates goals and MVP side markets', () => {
  const specs = _internal.matchToMarketSpecs(soccerMatch(), 'CL');

  assert.deepEqual(specs.map(spec => spec.source_event_id), [
    '100',
    '100:goals-over-2-5',
    '100:forward-mvp',
  ]);
  assert.deepEqual(specs.map(spec => spec.question), [
    'PSG vs Arsenal',
    '¿La final tendrá más de 2.5 goles?',
    '¿Un delantero gana el MVP de la final?',
  ]);
  assert.deepEqual(specs.map(spec => spec.outcomes), [
    ['PSG', 'Arsenal'],
    ['Sí', 'No'],
    ['Sí', 'No'],
  ]);
  assert.equal(specs[1].resolver_config.shape, 'total-goals-over');
  assert.equal(specs[1].resolver_config.threshold, 2.5);
  assert.equal(specs[2].resolver_type, null);
  assert.equal(specs[2].resolver_config, null);
});

test('non-final soccer matches keep the regular three-way draw market', () => {
  const spec = _internal.matchToMarketSpec(soccerMatch({ id: 101, stage: 'SEMI_FINALS' }), 'CL');

  assert.deepEqual(spec.outcomes, ['PSG', 'Empate', 'Arsenal']);
  assert.deepEqual(spec.outcome_images, ['psg.png', null, 'arsenal.png']);
  assert.equal(spec.resolver_config.shape, 'draw3');
  assert.equal(_internal.matchToMarketSpecs(soccerMatch({ id: 101, stage: 'SEMI_FINALS' }), 'CL').length, 1);
});
