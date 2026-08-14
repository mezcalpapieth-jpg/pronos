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

test('TikTok follow task points at the current Pronos account', () => {
  assert.match(source, /label:\s*'Seguir @pronosmarkets en TikTok'/);
  assert.match(source, /url:\s*'https:\/\/tiktok\.com\/@pronosmarkets'/);
  assert.doesNotMatch(source, /tiktok\.com\/@pronos\.io/);
});

test('static follow tasks reward 100 MXNP each', () => {
  assert.match(source, /key:\s*'instagram_follow'[\s\S]*?reward:\s*100/);
  assert.match(source, /key:\s*'tiktok_follow'[\s\S]*?reward:\s*100/);
  assert.match(source, /key:\s*'twitter_follow'[\s\S]*?reward:\s*100/);
  assert.doesNotMatch(source, /key:\s*'instagram_follow'[\s\S]*?reward:\s*300/);
  assert.doesNotMatch(source, /key:\s*'tiktok_follow'[\s\S]*?reward:\s*300/);
  assert.doesNotMatch(source, /key:\s*'twitter_follow'[\s\S]*?reward:\s*300/);
});

test('X follow task points at pronos_io and stays in manual review', () => {
  assert.match(source, /key:\s*'twitter_follow'/);
  assert.match(source, /label:\s*'Seguir @pronos_io en X'/);
  assert.match(source, /network:\s*'x'/);
  assert.match(source, /url:\s*'https:\/\/x\.com\/pronos_io'/);
  assert.match(source, /Sigue nuestra cuenta de X y sube captura/);
  assert.doesNotMatch(source, /verification:\s*'x_follow'/);
  assert.doesNotMatch(source, /autoVerify:\s*true/);
  assert.doesNotMatch(source, /requiresProvider:\s*'x'/);
  assert.doesNotMatch(source, /twitter\.com\/pronos_io/);
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

test('submit API keeps the X OAuth verification skeleton gated by task metadata', async () => {
  const submitSource = await readFile(new URL('./submit.js', import.meta.url), 'utf8');
  assert.match(submitSource, /xUserFollowsTarget/);
  assert.match(submitSource, /xUserFollowsTargetFromUserToken/);
  assert.match(submitSource, /xFollowTargetWithUserToken/);
  assert.match(submitSource, /xTokenHasScope/);
  assert.match(submitSource, /decryptOAuthToken/);
  assert.match(submitSource, /task\?\.verification === 'x_follow'/);
  assert.doesNotMatch(submitSource, /task\?\.key === 'twitter_follow'/);
  assert.match(submitSource, /x_account_required/);
  assert.match(submitSource, /x_reconnect_required/);
  assert.match(submitSource, /x_api_credits_depleted/);
  assert.match(submitSource, /x_follow_not_verified/);
  assert.match(submitSource, /X_AUTO_REVIEWER = 'x:auto'/);
  assert.match(submitSource, /status = 'approved'/);
  assert.match(submitSource, /autoVerified: true/);
});

test('resubmitting a rejected task clears current review metadata', async () => {
  const submitSource = await readFile(new URL('./submit.js', import.meta.url), 'utf8');
  assert.match(submitSource, /WHEN social_tasks\.status = 'rejected' THEN 'pending'/);
  assert.match(submitSource, /reviewer = CASE/);
  assert.match(submitSource, /reviewed_at = CASE/);
  assert.match(submitSource, /WHEN social_tasks\.status = 'rejected' THEN NULL/);
});
