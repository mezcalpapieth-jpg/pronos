import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './ufc.js';

test('UFC date filter keeps only fights inside the two-week import window', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  assert.equal(_internal.shouldKeepFightDate('2026-05-29T11:59:59.000Z', now), true);
  assert.equal(_internal.shouldKeepFightDate('2026-05-29T12:01:00.000Z', now), false);
  assert.equal(_internal.shouldKeepFightDate('2027-01-01T03:57:00.000Z', now), false);
});

test('UFC fight markets are unified binary markets', () => {
  const spec = _internal.buildFightMarket({
    id: 'ufc-321',
    name: 'UFC 321: Sample vs Rival',
    date: '2026-05-20T02:00:00.000Z',
  }, {
    id: 'fight-1',
    date: '2026-05-20T03:30:00.000Z',
    type: { abbreviation: 'LW' },
    competitors: [
      {
        id: '101',
        athlete: {
          id: '101',
          displayName: 'Sample Fighter',
          flag: { alt: 'Mexico' },
        },
      },
      {
        id: '202',
        athlete: {
          id: '202',
          displayName: 'Rival Fighter',
          flag: { alt: 'United States' },
        },
      },
    ],
  }, true);

  assert.equal(spec.amm_mode, 'unified');
  assert.equal(spec.resolver_type, 'sports_api');
  assert.equal(spec.resolver_config.source, 'espn-mma');
  assert.equal(spec.resolver_config.shape, 'binary');
  assert.equal(spec.resolver_config.homeName, 'Sample Fighter');
  assert.equal(spec.resolver_config.awayName, 'Rival Fighter');
  assert.deepEqual(spec.resolver_config.fighterIds, ['101', '202']);
  assert.deepEqual(spec.outcomes, ['Sample Fighter', 'Rival Fighter']);
  assert.equal(spec.source_event_id, 'mma:ufc-321:fight-1');
});
