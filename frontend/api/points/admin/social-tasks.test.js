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
