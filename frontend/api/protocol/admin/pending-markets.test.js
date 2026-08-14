/**
 * Static routing checks for the MVP protocol pending-markets API.
 *
 * Run with:
 *   node --test frontend/api/protocol/admin/pending-markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schemaSource = await readFile(new URL('../../_lib/protocol-schema.js', import.meta.url), 'utf8');
const runGeneratorsSource = await readFile(new URL('./run-generators.js', import.meta.url), 'utf8').catch(() => '');
const pendingSource = await readFile(new URL('./pending-markets.js', import.meta.url), 'utf8').catch(() => '');
const helperSource = await readFile(new URL('../../_lib/run-generators.js', import.meta.url), 'utf8');

test('protocol schema owns a separate generated-market review queue', () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS protocol_pending_markets/);
  assert.match(schemaSource, /approved_protocol_market_id INTEGER REFERENCES protocol_markets\(id\)/);
  assert.doesNotMatch(schemaSource, /protocol_pending_markets[\s\S]+approved_market_id INTEGER REFERENCES points_markets/);
});

test('protocol generator endpoint upserts into protocol pending markets', () => {
  assert.match(runGeneratorsSource, /ensureProtocolSchema/);
  assert.match(runGeneratorsSource, /upsertProtocolPending/);
  assert.match(helperSource, /export async function upsertProtocolPending/);
  assert.match(helperSource, /INSERT INTO protocol_pending_markets/);
  assert.doesNotMatch(runGeneratorsSource, /ensurePointsSchema/);
  assert.doesNotMatch(runGeneratorsSource, /upsertPending\(/);
});

test('protocol pending review endpoint never writes points markets', () => {
  assert.match(pendingSource, /protocol_pending_markets/);
  assert.match(pendingSource, /protocol_markets/);
  assert.match(pendingSource, /action !== 'approve' && action !== 'reject' && action !== 'readd'/);
  assert.match(pendingSource, /deployMarketOnChain/);
  assert.doesNotMatch(pendingSource, /points_pending_markets/);
  assert.doesNotMatch(pendingSource, /points_markets/);
});

test('protocol readd keeps human-overridden rows pending through auto-reject cleanup', () => {
  assert.match(pendingSource, /admin_note\s*=\s*COALESCE\(NULLIF\(\$2,\s*''\),\s*'manual-readded from rejected'\)/);
  assert.match(pendingSource, /reviewer\s*=\s*\$3/);
  assert.match(pendingSource, /reviewed_at\s*=\s*NOW\(\)/);
  assert.match(pendingSource, /approved_protocol_market_id\s*=\s*NULL/);
  const overrideGuardCount = pendingSource.match(/AND \(reviewer IS NULL OR reviewer = 'system'\)/g)?.length || 0;
  assert.ok(overrideGuardCount >= 2);
});
