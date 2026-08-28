/**
 * Static behavior checks for the admin markets list.
 *
 * Run with:
 *   node --test frontend/api/points/admin/markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./markets.js', import.meta.url), 'utf8');

test('admin markets applies cheap curation filters before the database limit', () => {
  const categoryFilterCount = source.match(/\$\{categoryFilter\}::text IS NULL OR m\.category = \$\{categoryFilter\}::text/g)?.length || 0;
  const cryptoRapidFilterCount = source.match(/\$\{cryptoTypeFilter\}::text = '5min' AND m\.resolver_config->>'shape' = 'binary-direction'/g)?.length || 0;

  assert.ok(categoryFilterCount >= 4, 'category filter should be in every admin query branch before LIMIT');
  assert.ok(cryptoRapidFilterCount >= 4, 'crypto rapid filter should be in every admin query branch before LIMIT');
  assert.match(source, /m\.sport = \$\{sportFilter\}::text/);
  assert.match(source, /m\.league = \$\{leagueFilter\}::text/);
  assert.match(source, /\$\{cryptoTypeFilter\}::text = 'general' AND COALESCE\(m\.resolver_config->>'shape', ''\) <> 'binary-direction'/);
});

test('active admin markets sort live rows before stale active rows', () => {
  assert.match(source, /CASE WHEN \$\{filter\}::text = 'active'/);
  assert.match(source, /m\.start_time <= NOW\(\)/);
  assert.match(source, /m\.end_time > NOW\(\) THEN 0 ELSE 1 END/);
  assert.match(source, /CASE WHEN \$\{filter\}::text = 'active' THEN m\.end_time END ASC NULLS LAST/);
});

test('admin markets includes editable market and outcome image metadata', () => {
  assert.match(source, /m\.image_url/);
  assert.match(source, /imageUrl:\s*r\.image_url \|\| null/);
  assert.match(source, /outcomeImages:\s*parseJsonb\(r\.outcome_images,\s*null\)/);
});
