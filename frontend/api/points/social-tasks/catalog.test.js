/**
 * Static behavior checks for the public social task catalog.
 *
 * Run with:
 *   node --test frontend/api/points/social-tasks/catalog.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./catalog.js', import.meta.url), 'utf8');

test('public social task catalog no longer exposes vague like/repost tasks', () => {
  assert.match(source, /STATIC_TASK_CATALOG/);
  assert.doesNotMatch(source, /tiktok_like/);
  assert.doesNotMatch(source, /instagram_repost/);
  assert.doesNotMatch(source, /Dar me-gusta/);
  assert.doesNotMatch(source, /Repostear una story/);
});

test('hidden campaign tasks require an exact expiring task link', () => {
  assert.match(source, /requestedTaskKey/);
  assert.match(source, /req\.query\.task/);
  assert.match(source, /social_task_campaigns/);
  assert.match(source, /expires_at > NOW\(\)/);
  assert.match(source, /hidden = FALSE OR task_key = \$\{requestedTaskKey \|\| null\}/);
  assert.match(source, /requestedTaskKey \? \[\.\.\.campaignTasks, \.\.\.STATIC_TASK_CATALOG\]/);
});

test('submit API can resolve static and campaign tasks through a shared lookup', async () => {
  const submitSource = await readFile(new URL('./submit.js', import.meta.url), 'utf8');
  assert.match(source, /export async function findSocialTaskByKey/);
  assert.match(submitSource, /findSocialTaskByKey/);
  assert.match(submitSource, /task\.url/);
});

test('resubmitting a rejected task clears current review metadata', async () => {
  const submitSource = await readFile(new URL('./submit.js', import.meta.url), 'utf8');
  assert.match(submitSource, /WHEN social_tasks\.status = 'rejected' THEN 'pending'/);
  assert.match(submitSource, /reviewer = CASE/);
  assert.match(submitSource, /reviewed_at = CASE/);
  assert.match(submitSource, /WHEN social_tasks\.status = 'rejected' THEN NULL/);
});
