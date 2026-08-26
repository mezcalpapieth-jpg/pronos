import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./correct-resolution.js', import.meta.url), 'utf8');
const schemaSource = await readFile(new URL('../../_lib/points-schema.js', import.meta.url), 'utf8');
const migrateSource = await readFile(new URL('../../migrate.js', import.meta.url), 'utf8');

test('correct-resolution is admin-only and only edits already resolved parent markets', () => {
  assert.match(source, /requirePointsAdmin\(req, res\)/);
  assert.match(source, /market_not_resolved/);
  assert.match(source, /leg_not_directly_correctable/);
  assert.match(source, /winningOutcomeIndex/);
});

test('correct-resolution keeps immutable redemption history and writes reversal ledger rows', () => {
  assert.match(source, /points_resolution_corrections/);
  assert.match(source, /points_redemption_reversals/);
  assert.match(source, /redemption_reversal/);
  assert.match(source, /ON CONFLICT \(redeem_trade_id\) DO NOTHING/);
  assert.match(source, /legacyReversedByUserMarket/);
  assert.match(source, /points_balances/);
  assert.match(source, /points_positions/);
  assert.match(source, /points_distributions/);
});

test('correct-resolution refreshes holder data and releases stale orders', () => {
  assert.match(source, /DELETE FROM points_top_holder_snapshots/);
  assert.match(source, /bestEffortPersistTopHolderSnapshot/);
  assert.match(source, /releaseOpenLimitOrdersForMarkets/);
});

test('schema and standalone migrate include correction tables', () => {
  for (const migrationSource of [schemaSource, migrateSource]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_resolution_corrections/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_redemption_reversals/);
    assert.match(migrationSource, /idx_points_resolution_corrections_market/);
    assert.match(migrationSource, /idx_points_redemption_reversals_market_user/);
  }
  assert.match(schemaSource, /points_resolution_corrections/);
  assert.match(schemaSource, /points_redemption_reversals/);
});
