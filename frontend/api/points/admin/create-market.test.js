import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./create-market.js', import.meta.url), 'utf8');

test('points admin direct create stores manual review resolver metadata', () => {
  assert.match(source, /resolutionSource/);
  assert.match(source, /resolutionCriteria/);
  assert.match(source, /ALLOWED_MANUAL_RESOLVERS/);
  assert.match(source, /manual_review/);
  assert.match(source, /resolver_type,\s*resolver_config/);
  assert.match(source, /source,\s*source_event_id/);
  assert.match(source, /inferSourceFromUrl/);
  assert.match(source, /inegi\.org\.mx/);
  assert.match(source, /buildMarketContextBlocks/);
  assert.match(source, /contextBlocks/);
  assert.match(source, /validateBeforeMonthDeadline/);
  assert.match(source, /deadlineCheck/);
});

test('points admin direct create keeps parallel leg markets free of duplicate source ids', () => {
  assert.match(source, /sourceEventIdVal/);
  assert.match(source, /resolverConfigJson/);
  assert.match(source, /display metadata; legs carry/);
  assert.match(source, /parent_id,\s*leg_label/);
  assert.match(source, /\(question,\s*category,\s*icon,\s*image_url,\s*outcomes,\s*reserves/);
});

test('points admin direct create stores market display image refs', () => {
  assert.match(source, /imageUrl\?/);
  assert.match(source, /cleanOptionalMarketImageRef/);
  assert.match(source, /invalid_market_image_url/);
  assert.match(source, /image_url/);
  assert.match(source, /imageUrl:\s*marketImageUrl/);
});
