/**
 * Static behavior checks for early NO resolution on parallel child legs.
 *
 * Run with:
 *   node --test frontend/api/points/admin/resolve-parallel-leg-no.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./resolve-parallel-leg-no.js', import.meta.url), 'utf8');

test('resolve-parallel-leg-no is admin-only and transactional', () => {
  assert.match(source, /POST \/api\/points\/admin\/resolve-parallel-leg-no/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /withTransaction/);
  assert.match(source, /ensurePointsSchema/);
});

test('resolve-parallel-leg-no only accepts active child legs under an active parallel parent', () => {
  assert.match(source, /market_is_not_parallel_leg/);
  assert.match(source, /parent_market_mismatch/);
  assert.match(source, /leg_not_active/);
  assert.match(source, /parent_market_not_active/);
  assert.match(source, /parent_market_not_parallel/);
});

test('resolve-parallel-leg-no resolves the child as No without cascading siblings', () => {
  assert.match(source, /noOutcomeIndex/);
  assert.match(source, /releaseOpenLimitOrdersForMarkets\(client, \[Number\(leg\.id\)\]/);
  assert.match(source, /status = 'resolved'/);
  assert.match(source, /outcome = \$2/);
  assert.match(source, /earlyNoResolution/);
  assert.doesNotMatch(source, /WHERE parent_id = \$1\\s+AND status = 'active'/);
});
