import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const statsSource = await readFile(new URL('./stats.js', import.meta.url), 'utf8');
const pulseSource = await readFile(new URL('../analytics/pulse.js', import.meta.url), 'utf8');
const pointsSchema = await readFile(new URL('../../_lib/points-schema.js', import.meta.url), 'utf8');
const migrate = await readFile(new URL('../../migrate.js', import.meta.url), 'utf8');

test('admin stats includes invested volume, site time, publicity links, and per-user activity', () => {
  assert.match(statsSource, /invested_volume/);
  assert.match(statsSource, /points_site_time_daily/);
  assert.match(statsSource, /points_publicity_daily/);
  assert.match(statsSource, /PUBLICITY_SOURCES/);
  assert.match(statsSource, /share_pct/);
  assert.match(statsSource, /activityRows/);
  assert.match(statsSource, /distributionUserRows/);
  assert.match(statsSource, /signupRows/);
  assert.match(statsSource, /display_name/);
  assert.match(statsSource, /profile_image_url/);
  assert.match(statsSource, /volume:\s*\{/);
  assert.match(statsSource, /siteTime:\s*\{/);
  assert.match(statsSource, /publicity:\s*\{/);
  assert.match(statsSource, /activity: activityRows/);
  assert.match(statsSource, /userSignups:/);
  assert.match(statsSource, /points_publicity_attributions/);
  assert.match(statsSource, /LOWER\(ru\.username\) = LOWER\(t\.username\)/);
  assert.match(statsSource, /recentDistributions: distRows\.map/);
  assert.match(statsSource, /usersForKind = distributionUserRows\.filter/);
  assert.match(statsSource, /hiddenUsers:/);
  assert.match(statsSource, /displayName:\s*r\.display_name/);
  assert.match(statsSource, /profileImageUrl:\s*r\.profile_image_url/);
  assert.doesNotMatch(statsSource, /rn <= CASE WHEN kind = 'referral_bonus'/);
});

test('site-time heartbeat stores only daily aggregate seconds per user', () => {
  assert.match(pulseSource, /points_site_time_daily/);
  assert.match(pulseSource, /ON CONFLICT \(username, day\) DO UPDATE/);
  assert.match(pulseSource, /readSession/);
  assert.match(pulseSource, /rateLimit/);
});

test('site-time and publicity analytics tables are present in runtime and manual migrations', () => {
  for (const migrationSource of [pointsSchema, migrate]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_site_time_daily/);
    assert.match(migrationSource, /PRIMARY KEY \(username, day\)/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_publicity_daily/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_publicity_visitors/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_publicity_attributions/);
    assert.match(migrationSource, /PRIMARY KEY \(source, day\)/);
    assert.match(migrationSource, /PRIMARY KEY \(visitor_key, source, day\)/);
    assert.match(migrationSource, /username\s+TEXT PRIMARY KEY/);
    assert.match(migrationSource, /idx_points_users_created_at/);
    assert.match(migrationSource, /idx_points_distributions_created_kind_user/);
  }
});
