import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./trade-activity.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const migrate = await readFile(new URL('../migrate.js', import.meta.url), 'utf8');

test('points trade activity is anonymous, bucketed, and bounded', () => {
  assert.match(source, /GET \/api\/points\/trade-activity/);
  assert.match(source, /outcome=all/);
  assert.match(source, /outcomeParam === 'all'/);
  assert.match(source, /if \(allOutcomes\)/);
  assert.match(source, /points_trades/);
  assert.match(source, /side IN \('buy', 'sell'\)/);
  assert.match(source, /GROUP BY market_id, bucket_at/);
  assert.match(source, /COUNT\(\*\)::int AS count/);
  assert.match(source, /SUM\(collateral\)/);
  assert.match(source, /slice\(0, 200\)/);
  assert.match(source, /windowHours/);
  assert.match(source, /\|\| ' hours'/);
  assert.match(source, /max: 60/);
  assert.match(source, /max: 120/);
  assert.doesNotMatch(source, /username/);
});

test('trade activity query has a market/outcome/time index', () => {
  for (const migrationSource of [schema, migrate]) {
    assert.match(migrationSource, /idx_points_trades_market_outcome_created/);
    assert.match(migrationSource, /ON points_trades\(market_id, outcome_index, created_at DESC\)/);
    assert.match(migrationSource, /idx_points_trades_market_created/);
    assert.match(migrationSource, /ON points_trades\(market_id, created_at DESC\)/);
    assert.match(migrationSource, /WHERE side IN \('buy', 'sell'\)/);
  }
});
