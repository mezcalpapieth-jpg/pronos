/**
 * Static checks for the Points pending-markets admin queue.
 *
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsAdmin.pending-markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('Points admin exposes a re-add action for rejected generated markets', () => {
  assert.match(source, /filter === 'rejected'/);
  assert.match(source, /review\(r\.id,\s*'readd'\)/);
  assert.match(source, /Reagregar/);
  assert.match(apiSource, /adminReviewPendingMarket\(id,\s*action,\s*note\)/);
});

test('Points admin tabs show pending-work badges outside the active tab', () => {
  assert.match(source, /adminTaskCounts/);
  assert.match(source, /adminListPendingMarkets\('pending'\)/);
  assert.match(source, /\/api\/points\/admin\/markets\?status=pending/);
  assert.match(source, /adminListSocialTasks\('pending'\)/);
  assert.match(source, /tab !== t\.id/);
  assert.match(source, /taskCount > 0/);
});
