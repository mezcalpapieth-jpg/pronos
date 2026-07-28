import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./points-schema.js', import.meta.url), 'utf8');

test('points schema self-healing avoids hot-route migration lock pileups', () => {
  assert.match(source, /POINTS_SCHEMA_READY_PROBE/);
  assert.match(source, /to_regclass\('public\.points_publicity_daily'\)/);
  assert.match(source, /to_regclass\('public\.points_resolution_candidates'\)/);
  assert.match(source, /POINTS_SCHEMA_LOCK_TABLE/);
  assert.match(source, /points_schema_locks/);
  assert.match(source, /locked_until/);
  assert.match(source, /ON CONFLICT \(name\) DO UPDATE/);
  assert.match(source, /if \(!acquired\) \{/);
  assert.match(source, /return;\s*\n\s*\}/);
  assert.match(source, /runSchemaMigration/);
  assert.match(source, /SET LOCAL lock_timeout/);
  assert.match(source, /deadlock_detected/);
  assert.match(source, /lock_not_available/);
  assert.match(source, /statement_timeout/);
});
