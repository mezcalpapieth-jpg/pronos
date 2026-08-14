import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findParallelWinnerIndex,
  isNextOpponentCheckDue,
} from './sports-resolver-policy.js';

test('findParallelWinnerIndex loosely matches shortened winner labels before Otro fallback', () => {
  const legs = [
    { label: 'Sean Strickland', driverId: 'strickland' },
    { label: 'Dricus Du Plessis', driverId: 'dricus' },
    { label: 'Otro', driverId: null },
  ];

  assert.equal(
    findParallelWinnerIndex(legs, { winnerDriverId: null, winnerDriverLabel: 'Strickland' }),
    0,
  );
});

test('findParallelWinnerIndex still falls back to Otro when no listed leg matches', () => {
  const legs = [
    { label: 'Michael Chandler', driverId: 'chandler' },
    { label: 'Justin Gaethje', driverId: 'gaethje' },
    { label: 'Otro', driverId: null },
  ];

  assert.equal(
    findParallelWinnerIndex(legs, { winnerDriverId: null, winnerDriverLabel: 'Paddy Pimblett' }),
    2,
  );
});

test('isNextOpponentCheckDue rate-limits open-ended booking checks', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  const base = {
    resolverType: 'sports_api',
    resolverConfig: {
      source: 'next-opponent',
      shape: 'parallel',
    },
    endTime: '2026-10-01T00:00:00.000Z',
    now,
  };

  assert.equal(isNextOpponentCheckDue(base), true);
  assert.equal(
    isNextOpponentCheckDue({
      ...base,
      resolverConfig: {
        ...base.resolverConfig,
        nextOpponentLastCheckedAt: '2026-05-15T02:00:00.000Z',
      },
    }),
    false,
  );
  assert.equal(
    isNextOpponentCheckDue({
      ...base,
      resolverConfig: {
        ...base.resolverConfig,
        nextOpponentLastCheckedAt: '2026-05-14T23:30:00.000Z',
      },
    }),
    true,
  );
});
