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
