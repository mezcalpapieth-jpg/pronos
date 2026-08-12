import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./append-parallel-outcomes.js', import.meta.url), 'utf8');

test('append parallel outcomes only mutates parallel parent markets by appending legs', () => {
  assert.match(source, /append-parallel-outcomes/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /parent\.amm_mode !== 'parallel'/);
  assert.match(source, /parent\.parent_id/);
  assert.match(source, /duplicate_outcomes/);
  assert.match(source, /WHERE parent_id = \$1\s+AND status <> 'canceled'/);
  assert.match(source, /INSERT INTO points_markets/);
  assert.match(source, /parent_id,\s*leg_label/);
  assert.match(source, /UPDATE points_markets[\s\S]*outcomes = \$1::jsonb/);
  assert.match(source, /alignResolverLegs/);
  assert.match(source, /manuallyAddedAt/);
  assert.match(source, /safe for in-flight tennis\/golf/);
  assert.match(source, /parent\.status/);
  assert.match(source, /\['active', 'pending'\]\.includes\(parent\.status\)/);
});
