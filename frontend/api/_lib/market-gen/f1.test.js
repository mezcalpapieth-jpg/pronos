import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './f1.js';

test('Dutch GP side markets include hooky auto-resolving F1 props', () => {
  const specs = _internal.buildDutchGpSideMarkets({
    season: '2026',
    round: '12',
    raceName: 'Dutch Grand Prix',
    startTime: '2026-08-23T13:00:00.000Z',
    endTime: '2026-08-23T15:00:00.000Z',
    imageByDriverId: new Map([
      ['perez', 'cadillac-perez.png'],
      ['bottas', 'cadillac-bottas.png'],
      ['max_verstappen', 'red-bull.png'],
    ]),
    portraitByDriverId: new Map([
      ['perez', 'perez-face.png'],
      ['bottas', 'bottas-face.png'],
    ]),
    imageByTeamKey: new Map([
      ['cadillac', 'cadillac.png'],
      ['red-bull', 'red-bull.png'],
    ]),
  });

  assert.equal(specs.length, 3);
  assert.deepEqual(specs.map(spec => spec.source_event_id), [
    'f1:2026:12:perez-ahead-bottas',
    'f1:2026:12:verstappen-first-win-home',
    'f1:2026:12:perez-first-points',
  ]);
  assert.deepEqual(specs.map(spec => spec.resolver_config.shape), [
    'driver-ahead',
    'driver-wins',
    'driver-points',
  ]);
  assert.equal(specs[0].resolver_config.driverAId, 'perez');
  assert.equal(specs[0].resolver_config.driverBId, 'bottas');
  assert.equal(specs[0].question, '¿Quién terminará delante en la carrera del Dutch GP 2026: Checo Pérez o Valtteri Bottas?');
  assert.deepEqual(specs[0].outcomes, ['Checo Pérez', 'Valtteri Bottas']);
  assert.deepEqual(specs[0].outcome_images, ['perez-face.png', 'bottas-face.png']);
  assert.equal(specs[0].source_data.marketStyle, 'head-to-head');
  assert.equal(specs[1].resolver_config.driverId, 'max_verstappen');
  assert.equal(specs[2].resolver_config.driverId, 'perez');
});

test('Dutch GP side markets only emit for the 2026 Dutch race', () => {
  assert.deepEqual(_internal.buildDutchGpSideMarkets({
    season: '2026',
    round: '13',
    raceName: 'Italian Grand Prix',
    startTime: '2026-09-06T13:00:00.000Z',
    endTime: '2026-09-06T15:00:00.000Z',
  }), []);

  assert.deepEqual(_internal.buildDutchGpSideMarkets({
    season: '2027',
    round: '12',
    raceName: 'Dutch Grand Prix',
    startTime: '2027-08-22T13:00:00.000Z',
    endTime: '2027-08-22T15:00:00.000Z',
  }), []);
});

test('Checo vs Bottas head-to-head has local portraits without upstream images', () => {
  const specs = _internal.buildDutchGpSideMarkets({
    season: '2026',
    round: '12',
    raceName: 'Dutch Grand Prix',
    startTime: '2026-08-23T13:00:00.000Z',
    endTime: '2026-08-23T15:00:00.000Z',
  });

  assert.deepEqual(specs[0].outcome_images, [
    '/f1-headshots/checo-perez-face.png',
    '/f1-headshots/valtteri-bottas-face.png',
  ]);
});
