import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./overview.js', import.meta.url), 'utf8');

test('AICM overview endpoint is public, cached, and read-only', () => {
  assert.match(source, /GET \/api\/points\/aicm\/overview/);
  assert.match(source, /cachedJson\('points:aicm:overview:v3'/);
  assert.match(source, /DATABASE_READ_URL \|\| process\.env\.DATABASE_URL/);
  assert.match(source, /points_aicm_poll_runs/);
  assert.match(source, /points_aicm_flight_observations/);
  assert.match(source, /points_aicm_timetable_observations/);
  assert.match(source, /resolverCounters/);
  assert.match(source, /thresholdFlights/);
  assert.match(source, /o\.delay_minutes > 30/);
  assert.match(source, /COUNT\(\*\) OVER\(\)::int AS "totalFlights"/);
  assert.match(source, /normalizeAicmObservationForDisplay/);
  assert.match(source, /normalizeAicmFlightCode/);
  assert.match(source, /delayMinutes/);
  assert.match(source, /timetableByFlight/);
  assert.match(source, /COALESCE\(o\.flight_code, ''\) ~ '\[A-Za-z\]'/);
  assert.match(source, /COALESCE\(o\.raw_cells::text, ''\) ~ '\[A-Za-z\]\{1,4\}\[0-9\]'/);
  assert.match(source, /\.filter\(row => row\.flightCode && row\.scheduledTimeLocal && row\.city\)/);
  assert.match(source, /LIMIT 180/);
  assert.match(source, /board: \{/);
  assert.match(source, /aicm_tables_missing/);
  assert.doesNotMatch(source, /ensurePointsSchema/);
  assert.doesNotMatch(source, /INSERT INTO/);
  assert.doesNotMatch(source, /UPDATE points_/);
  assert.doesNotMatch(source, /DELETE FROM/);
});
