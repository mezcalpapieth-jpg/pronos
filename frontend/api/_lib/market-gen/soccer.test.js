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

test('continental soccer cups import every fixture with canonical league slugs', () => {
  assert.deepEqual(_internal.COMPETITIONS_ALL_FIXTURES, ['CL', 'EL', 'UCL', 'CLI']);

  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'EL').league, 'uefa-europa-league');
  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'UCL').league, 'uefa-conference-league');
  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'CLI').league, 'copa-libertadores');
});

test('one-legged continental finals generate binary winner markets', () => {
  const europaFinal = _internal.matchToMarketSpec(soccerMatch(), 'EL');
  const conferenceFinal = _internal.matchToMarketSpec(soccerMatch(), 'UCL');
  const libertadoresFinal = _internal.matchToMarketSpec(soccerMatch(), 'CLI');

  assert.deepEqual(europaFinal.outcomes, ['PSG', 'Arsenal']);
  assert.deepEqual(conferenceFinal.outcomes, ['PSG', 'Arsenal']);
  assert.deepEqual(libertadoresFinal.outcomes, ['PSG', 'Arsenal']);
  assert.equal(europaFinal.resolver_config.shape, 'binary');
  assert.equal(conferenceFinal.resolver_config.shape, 'binary');
  assert.equal(libertadoresFinal.resolver_config.shape, 'binary');
});

test('UEFA final fallbacks fill Europa and Conference when upstream is empty', () => {
  const europa = _internal.fallbackFinalMatchesForCompetition('EL', '2026-05-20', '2026-05-21');
  const conference = _internal.fallbackFinalMatchesForCompetition('UCL', '2026-05-20', '2026-05-28');

  const europaSpec = _internal.matchToMarketSpec(europa[0], 'EL');
  const conferenceSpec = _internal.matchToMarketSpec(conference[0], 'UCL');

  assert.equal(europaSpec.question, 'Freiburg vs Aston Villa');
  assert.deepEqual(europaSpec.outcomes, ['Freiburg', 'Aston Villa']);
  assert.equal(europaSpec.source, 'uefa.com');
  assert.equal(europaSpec.resolver_type, 'sports_api');
  assert.deepEqual(europaSpec.resolver_config, {
    source: 'espn',
    leaguePath: 'soccer/uefa.europa',
    eventId: null,
    dateYmd: '2026-05-20',
    homeName: 'Freiburg',
    awayName: 'Aston Villa',
    shape: 'binary',
  });
  assert.equal(europaSpec.source_event_id, 'uefa-2026-europa-final');

  assert.equal(conferenceSpec.question, 'Crystal Palace vs Rayo Vallecano');
  assert.deepEqual(conferenceSpec.outcomes, ['Crystal Palace', 'Rayo Vallecano']);
  assert.equal(conferenceSpec.source, 'uefa.com');
  assert.equal(conferenceSpec.resolver_type, 'sports_api');
  assert.equal(conferenceSpec.resolver_config.leaguePath, 'soccer/uefa.europa.conf');
  assert.equal(conferenceSpec.resolver_config.shape, 'binary');
  assert.equal(conferenceSpec.source_event_id, 'uefa-2026-conference-final');
});

test('UEFA final fallbacks only apply inside the generation window', () => {
  assert.deepEqual(_internal.fallbackFinalMatchesForCompetition('EL', '2026-05-21', '2026-05-28'), []);
  assert.deepEqual(_internal.fallbackFinalMatchesForCompetition('UCL', '2026-05-20', '2026-05-26'), []);
  assert.deepEqual(_internal.fallbackFinalMatchesForCompetition('CL', '2026-05-20', '2026-05-28'), []);
});
