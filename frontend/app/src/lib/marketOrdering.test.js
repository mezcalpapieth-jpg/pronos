import test from 'node:test';
import assert from 'node:assert/strict';

import { sortMarketsByLiveThenEndDate } from './marketOrdering.js';

test('trending market ordering puts live first, then upcoming by close date', () => {
  const now = new Date('2026-10-01T15:00:00.000Z').getTime();
  const rows = [
    { id: 'november', status: 'active', endTime: '2026-11-01T06:59:00.000Z' },
    { id: 'overdue', status: 'active', endTime: '2026-10-01T14:00:00.000Z' },
    { id: 'tomorrow', status: 'active', endTime: '2026-10-02T18:00:00.000Z' },
    { id: 'live', status: 'active', live: true, endTime: '2026-10-03T03:00:00.000Z' },
    { id: 'undated', status: 'active' },
    { id: 'tonight', status: 'active', endTime: '2026-10-01T23:59:00.000Z' },
  ];

  assert.deepEqual(
    sortMarketsByLiveThenEndDate(rows, now).map(row => row.id),
    ['live', 'tonight', 'tomorrow', 'november', 'overdue', 'undated'],
  );
});

test('trending market ordering does not let tournament markets outrank earlier deadlines', () => {
  const now = new Date('2026-10-01T15:00:00.000Z').getTime();
  const rows = [
    { id: 'fed', status: 'active', tournamentFeatured: true, endTime: '2026-10-28T18:00:00.000Z' },
    { id: 'gdp', status: 'active', tournamentFeatured: true, endTime: '2026-10-30T05:59:00.000Z' },
    { id: 'sports-tomorrow', status: 'active', featured: true, endTime: '2026-10-02T02:00:00.000Z' },
    { id: 'soccer-tonight', status: 'active', featured: true, endTime: '2026-10-01T23:00:00.000Z' },
    { id: 'live-show', status: 'active', tournamentFeatured: true, live: true, endTime: '2026-10-02T04:00:00.000Z' },
  ];

  assert.deepEqual(
    sortMarketsByLiveThenEndDate(rows, now).map(row => row.id),
    ['live-show', 'soccer-tonight', 'sports-tomorrow', 'fed', 'gdp'],
  );
});
