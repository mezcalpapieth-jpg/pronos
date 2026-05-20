import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeScheduleWithMarkets } from './teamProfileSchedule.js';

test('team profile schedule links imported markets and marks missing imports pending', () => {
  const schedule = [
    {
      id: 'game-1',
      source: 'football-data.org',
      sourceEventId: '100',
      startsAt: '2026-05-30T16:00:00.000Z',
      homeName: 'PSG',
      awayName: 'Arsenal',
    },
    {
      id: 'game-2',
      source: 'football-data.org',
      sourceEventId: '101',
      startsAt: '2026-06-06T16:00:00.000Z',
      homeName: 'Arsenal',
      awayName: 'Chelsea',
    },
  ];
  const markets = [
    {
      id: 7,
      question: 'PSG vs Arsenal',
      status: 'active',
      source: 'football-data.org',
      sourceEventId: '100',
      startTime: '2026-05-30T16:00:00.000Z',
    },
  ];

  const rows = mergeScheduleWithMarkets(schedule, markets);

  assert.equal(rows[0].state, 'open');
  assert.equal(rows[0].market.id, 7);
  assert.equal(rows[1].state, 'pending');
  assert.equal(rows[1].market, null);
});

test('team profile schedule can link ESPN markets by resolver event id', () => {
  const rows = mergeScheduleWithMarkets(
    [{ id: '401', source: 'espn', sourceEventId: '401', homeName: 'Spurs', awayName: 'Thunder' }],
    [{
      id: 9,
      status: 'resolved',
      source: 'espn-nba',
      resolverConfig: { source: 'espn', eventId: '401' },
    }],
  );

  assert.equal(rows[0].state, 'resolved');
  assert.equal(rows[0].market.id, 9);
});
