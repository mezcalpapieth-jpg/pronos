import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeScheduleWithMarkets } from './teamProfileSchedule.js';

test('team profile schedule links imported markets and marks missing imports pending', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-05-30T15:00:00.000Z') });
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

test('team profile schedule marks past missing-market games closed', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-05-30T15:00:00.000Z') });
  const rows = mergeScheduleWithMarkets([
    {
      id: 'old-game',
      source: 'football-data.org',
      sourceEventId: '200',
      startsAt: '2020-05-30T16:00:00.000Z',
      status: 'FINISHED',
      homeName: 'PSG',
      awayName: 'Arsenal',
    },
    {
      id: 'future-game',
      source: 'football-data.org',
      sourceEventId: '201',
      startsAt: '2099-06-06T16:00:00.000Z',
      homeName: 'Arsenal',
      awayName: 'Chelsea',
    },
  ], []);

  assert.equal(rows[0].state, 'closed');
  assert.equal(rows[1].state, 'pending');
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

test('team schedules honor fixture statuses ahead of elapsed kickoff time and generic ESPN state', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-05-30T20:00:00.000Z') });
  const startsAt = '2026-05-30T15:00:00.000Z';
  const fixtures = [
    [{ status: 'in', statusDetail: '75′' }, 'live'],
    [{ status: 'post', statusCode: 'STATUS_POSTPONED' }, 'postponed'],
    [{ status: 'post', statusDetail: 'Postponed due to weather' }, 'postponed'],
    [{ status: 'post', statusCompleted: false }, 'pending'],
    [{ status: 'post', statusCode: 'STATUS_FINAL_OVERTIME', statusCompleted: true }, 'closed'],
    [{ status: 'SUSPENDED' }, 'suspended'],
    [{ status: 'PAUSED' }, 'live'],
    [{ status: 'CANCELLED' }, 'cancelado'],
    [{ status: 'TIMED' }, 'pending'],
    [{ status: 'unknown' }, 'pending'],
    [{}, 'closed'],
  ];

  const rows = mergeScheduleWithMarkets(fixtures.map(([status], id) => ({ id, startsAt, ...status })));
  assert.deepEqual(rows.map(row => row.state), fixtures.map(([, expected]) => expected));
});

test('a fixture interruption stays visible independently of its linked market status', () => {
  const [row] = mergeScheduleWithMarkets(
    [{ source: 'espn', sourceEventId: '401', status: 'post', statusCode: 'STATUS_SUSPENDED' }],
    [{ id: 9, source: 'espn', sourceEventId: '401', status: 'active' }],
  );

  assert.equal(row.state, 'open');
  assert.equal(row.fixtureState, 'suspended');
});
