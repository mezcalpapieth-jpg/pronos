/**
 * Static behavior checks for the generated pending-markets admin API.
 *
 * Run with:
 *   node --test frontend/api/points/admin/pending-markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./pending-markets.js', import.meta.url), 'utf8');

test('rejected pending markets list newest reviewed rows first', () => {
  assert.match(
    source,
    /CASE\s+WHEN\s+p\.status\s*=\s*'rejected'\s+THEN\s+p\.reviewed_at\s+END\s+DESC\s+NULLS\s+LAST/,
  );
  assert.match(source, /p\.created_at\s+DESC/);
});

test('rejected pending markets can be re-added to the review queue', () => {
  assert.match(source, /action !== 'approve' && action !== 'reject' && action !== 'readd'/);
  assert.match(source, /if \(action === 'readd'\)/);
  assert.match(source, /status\s*=\s*'pending'/);
  assert.match(source, /admin_note\s*=\s*COALESCE\(NULLIF\(\$2,\s*''\),\s*'manual-readded from rejected'\)/);
  assert.match(source, /reviewer\s*=\s*\$3/);
  assert.match(source, /reviewed_at\s*=\s*NOW\(\)/);
  assert.match(source, /approved_market_id\s*=\s*NULL/);
});

test('human re-added sports rows are not immediately auto-rejected again', () => {
  const overrideGuardCount = source.match(/AND \(reviewer IS NULL OR reviewer = 'system'\)/g)?.length || 0;
  assert.ok(overrideGuardCount >= 2);
});
