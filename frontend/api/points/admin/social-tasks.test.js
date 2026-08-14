/**
 * Static behavior checks for the social task admin API.
 *
 * Run with:
 *   node --test frontend/api/points/admin/social-tasks.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./social-tasks.js', import.meta.url), 'utf8');
const pointsSchema = await readFile(new URL('../../_lib/points-schema.js', import.meta.url), 'utf8');
const migrate = await readFile(new URL('../../migrate.js', import.meta.url), 'utf8');

test('social task list returns an explicit unavailable payload when Neon quota is exhausted', () => {
  assert.match(source, /isDatabaseQuotaError/);
  assert.match(source, /socialTasksUnavailablePayload/);
  assert.match(source, /req\.method === 'GET' && isDatabaseQuotaError\(e\)/);

  const unavailableResponses = source.match(/res\.status\(200\)\.json\(socialTasksUnavailablePayload\(\)\)/g) || [];
  assert.ok(unavailableResponses.length >= 2);
});

test('social task reviews still fail instead of pretending writes succeeded when the DB is unavailable', () => {
  const reviewSource = source.slice(source.indexOf('async function handleReview'));
  assert.doesNotMatch(reviewSource, /socialTasksUnavailablePayload/);
});

test('social task API initializes Neon clients lazily so unauthenticated requests avoid DB setup', () => {
  assert.match(source, /function getReadSql\(\)/);
  assert.match(source, /function getSchemaSql\(\)/);
  assert.doesNotMatch(source, /const sql = neon/);
  assert.doesNotMatch(source, /const schemaSql = neon/);
});

test('social task review columns are added for older existing tables', () => {
  for (const migrationSource of [pointsSchema, migrate]) {
    assert.match(migrationSource, /ALTER TABLE social_tasks ADD COLUMN IF NOT EXISTS reviewer TEXT/);
    assert.match(migrationSource, /ALTER TABLE social_tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ/);
    assert.match(migrationSource, /ALTER TABLE social_tasks ADD COLUMN IF NOT EXISTS rejection_note TEXT/);
  }
});

test('social task reviews are append-only and power reviewed tabs', () => {
  for (const migrationSource of [pointsSchema, migrate]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS social_task_reviews/);
    assert.match(migrationSource, /social_task_id INTEGER REFERENCES social_tasks\(id\) ON DELETE SET NULL/);
    assert.match(migrationSource, /action\s+TEXT NOT NULL CHECK \(action IN \('approved', 'rejected'\)\)/);
    assert.match(migrationSource, /idx_social_task_reviews_status_time/);
  }
  assert.match(source, /INSERT INTO social_task_reviews/);
  assert.match(source, /r\.action = \$\{status\}/);
  assert.match(source, /r\.social_task_id = s\.id/);
});

test('social task admin can load one combined history tab', () => {
  assert.match(source, /history/);
  assert.match(source, /status IN \('approved', 'rejected'\)/);
  assert.match(source, /FROM social_task_reviews r/);
  assert.match(source, /COALESCE\(e\.reviewed_at, e\.created_at\) DESC/);
});

test('social task admin supports hidden expiring post campaigns', () => {
  for (const migrationSource of [pointsSchema, migrate]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS social_task_campaigns/);
    assert.match(migrationSource, /task_key\s+TEXT UNIQUE NOT NULL/);
    assert.match(migrationSource, /target_url\s+TEXT NOT NULL/);
    assert.match(migrationSource, /expires_at\s+TIMESTAMPTZ NOT NULL/);
    assert.match(migrationSource, /hidden\s+BOOLEAN NOT NULL DEFAULT TRUE/);
  }

  assert.match(source, /create_campaign/);
  assert.match(source, /deactivate_campaign/);
  assert.match(source, /VALID_PLATFORMS/);
  assert.match(source, /normalizeTargetUrl/);
  assert.match(source, /req\.body\?\.reward \?\? 100/);
  assert.match(source, /status === 'campaigns'/);
  assert.match(source, /sharePath:\s*`\/earn\?task=/);
});

test('social task admin normalizes pending static follow rewards to 100 MXNP', () => {
  assert.match(source, /STATIC_FOLLOW_TASK_REWARDS/);
  assert.match(source, /\['instagram_follow', 100\]/);
  assert.match(source, /\['tiktok_follow', 100\]/);
  assert.match(source, /\['twitter_follow', 100\]/);
  assert.match(source, /function socialTaskReviewReward\(task\)/);
  assert.match(source, /function normalizePendingSocialTaskRows\(rows\)/);
  assert.match(source, /tasks: normalizePendingSocialTaskRows\(rows\)/);
  assert.match(source, /const reviewReward = socialTaskReviewReward\(task\)/);
  assert.match(source, /SET status = 'approved', reward = \$1/);
});

test('social task admin review queue includes exact campaign post metadata', () => {
  assert.match(source, /LEFT JOIN social_task_campaigns c ON c\.task_key = s\.task_key/);
  assert.match(source, /c\.target_url/);
  assert.match(source, /c\.label AS task_label/);
  assert.match(source, /c\.expires_at AS task_expires_at/);
});
