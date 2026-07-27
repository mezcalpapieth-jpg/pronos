import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const statsSource = await readFile(new URL('./stats.js', import.meta.url), 'utf8');
const pulseSource = await readFile(new URL('../analytics/pulse.js', import.meta.url), 'utf8');
const pointsSchema = await readFile(new URL('../../_lib/points-schema.js', import.meta.url), 'utf8');
const migrate = await readFile(new URL('../../migrate.js', import.meta.url), 'utf8');

test('admin stats includes invested volume, site time, and per-user activity', () => {
  assert.match(statsSource, /invested_volume/);
  assert.match(statsSource, /points_site_time_daily/);
  assert.match(statsSource, /share_pct/);
  assert.match(statsSource, /activityRows/);
  assert.match(statsSource, /volume:\s*\{/);
  assert.match(statsSource, /siteTime:\s*\{/);
  assert.match(statsSource, /activity: activityRows/);
});

test('site-time heartbeat stores only daily aggregate seconds per user', () => {
  assert.match(pulseSource, /points_site_time_daily/);
  assert.match(pulseSource, /ON CONFLICT \(username, day\) DO UPDATE/);
  assert.match(pulseSource, /readSession/);
  assert.match(pulseSource, /rateLimit/);
});

test('site-time analytics table is present in runtime and manual migrations', () => {
  for (const migrationSource of [pointsSchema, migrate]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_site_time_daily/);
    assert.match(migrationSource, /PRIMARY KEY \(username, day\)/);
  }
});
