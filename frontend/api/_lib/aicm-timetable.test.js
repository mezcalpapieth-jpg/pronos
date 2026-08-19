import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AICM_TT_SOURCE,
  buildAicmTimetableUrl,
  fetchAicmTimetable,
  parseAicmTimetable,
  readAicmTimetableDelayCount,
} from './aicm-timetable.js';

function row({
  scheduled, number = 'am100', delay = null, status = 'active',
  codeshared = null, arrival = 'gdl', actual = null,
}) {
  return {
    status,
    codeshared,
    departure: { iataCode: 'mex', scheduledTime: scheduled, delay, actualTime: actual },
    arrival: { iataCode: arrival },
    airline: { iataCode: number.slice(0, 2) },
    flight: { iataNumber: number },
  };
}

test('buildAicmTimetableUrl targets MEX departures', () => {
  const url = new URL(buildAicmTimetableUrl({ apiKey: 'k' }));
  assert.equal(url.searchParams.get('iataCode'), 'MEX');
  assert.equal(url.searchParams.get('type'), 'departure');
  assert.throws(() => buildAicmTimetableUrl({}), /api_key/);
});

test('parseAicmTimetable keeps operator flights and drops codeshares', () => {
  const out = parseAicmTimetable([
    row({ scheduled: '2026-08-20t06:00:00.000', number: 'am100', delay: 45 }),
    row({ scheduled: '2026-08-20t06:00:00.000', number: 'dl900', delay: 45, codeshared: { airline: {} } }),
    row({ scheduled: '2026-08-20t07:00:00.000', number: 'y4200', delay: 5 }),
  ], { observedAt: '2026-08-20T12:00:00Z' });

  assert.equal(out.totalRows, 3);
  assert.equal(out.codeshares, 1);
  assert.equal(out.observations.length, 2);
  assert.equal(out.source, AICM_TT_SOURCE);
});

test('the flight key stays stable as the delay grows across polls', () => {
  const early = parseAicmTimetable([
    row({ scheduled: '2026-08-20t06:00:00.000', number: 'am100', delay: 10 }),
  ]).observations[0];
  const late = parseAicmTimetable([
    row({ scheduled: '2026-08-20t06:00:00.000', number: 'am100', delay: 95 }),
  ]).observations[0];

  // Same flight, two readings: the store must overwrite, not duplicate.
  assert.equal(early.flightKey, late.flightKey);
  assert.equal(early.delayMinutes, 10);
  assert.equal(late.delayMinutes, 95);
});

test('parseAicmTimetable skips rows with no schedule or no flight number', () => {
  const out = parseAicmTimetable([
    row({ scheduled: null, number: 'am100' }),
    { status: 'active', departure: { scheduledTime: '2026-08-20t06:00:00.000' }, flight: {} },
    row({ scheduled: '2026-08-20t06:00:00.000', number: 'am100', delay: 1 }),
  ]);
  assert.equal(out.observations.length, 1);
});

test('fetchAicmTimetable surfaces an API-level error payload', async () => {
  await assert.rejects(
    () => fetchAicmTimetable({
      apiKey: 'k',
      fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'No Record Found' }) }),
    }),
    /aicm_tt_api_error/,
  );
});

test('readAicmTimetableDelayCount reports the stored window', async () => {
  const fakeSql = {
    query: async () => ({
      rows: [{
        count: 284, operator_flights: 857, cancelled: 3, days_covered: 2,
        poll_count: 40, ok_poll_count: 38, last_poll_observed_at: '2026-08-22T09:00:00Z',
      }],
    }),
  };
  const out = await readAicmTimetableDelayCount(fakeSql, {
    fromDateYmd: '2026-08-20', toDateYmd: '2026-08-21', thresholdMinutes: 30,
  });
  assert.equal(out.count, 284);
  assert.equal(out.daysCovered, 2);
  assert.equal(out.okPollCount, 38);
  assert.equal(out.source, AICM_TT_SOURCE);
});

test('readAicmTimetableDelayCount needs a range and a connection', async () => {
  await assert.rejects(() => readAicmTimetableDelayCount(null, {}), /requires_sql/);
  await assert.rejects(() => readAicmTimetableDelayCount({ query: async () => ({}) }, {}), /date_range/);
});
