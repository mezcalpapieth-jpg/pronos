import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./aicm-status.js', import.meta.url), 'utf8');

test('AICM oracle status is admin-only and read-only', () => {
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /ensurePointsSchema/);
  assert.match(source, /DATABASE_READ_URL/);
  assert.match(source, /points_aicm_poll_runs/);
  assert.match(source, /points_aicm_flight_observations/);
  assert.match(source, /recentDisruptions/);
  assert.doesNotMatch(source, /INSERT INTO/);
  assert.doesNotMatch(source, /UPDATE /);
  assert.doesNotMatch(source, /DELETE FROM/);
  assert.doesNotMatch(source, /points_markets/);
});
