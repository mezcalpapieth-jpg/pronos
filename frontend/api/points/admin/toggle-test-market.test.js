import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const handlerSrc = readFileSync(new URL('./toggle-test-market.js', import.meta.url), 'utf8');
const schemaSrc = readFileSync(new URL('../../_lib/points-schema.js', import.meta.url), 'utf8');
const generatorsSrc = readFileSync(new URL('../../_lib/run-generators.js', import.meta.url), 'utf8');
const pendingSrc = readFileSync(new URL('./pending-markets.js', import.meta.url), 'utf8');
const marketsSrc = readFileSync(new URL('../markets.js', import.meta.url), 'utf8');

test('the endpoint is admin-gated and demands exactly one target id', () => {
  assert.match(handlerSrc, /requirePointsAdmin/);
  assert.match(handlerSrc, /supply_exactly_one_of_marketId_pendingId/);
  assert.match(handlerSrc, /isTestMarket_must_be_boolean/);
});

test('the column exists on both markets and the approval queue', () => {
  assert.match(schemaSrc, /ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS is_test_market/);
  assert.match(schemaSrc, /ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS is_test_market/);
});

test('the readiness probe covers the new column', () => {
  // A migration without a matching probe entry never runs on production.
  assert.match(schemaSrc, /AS points_markets_is_test_market/);
  assert.match(schemaSrc, /AS points_pending_is_test_market/);
});

test('the flag survives generation and approval', () => {
  assert.match(generatorsSrc, /category_tags, geo_tags, topic_tags, is_test_market\)/);
  // Approval copies it into points_markets, or the badge dies at approval.
  assert.match(pendingSrc, /tournament_featured, is_test_market,/);
  assert.match(pendingSrc, /pendingIsTestMarket/);
});

test('regenerating a market never clears a badge an admin set by hand', () => {
  assert.match(
    generatorsSrc,
    /is_test_market\s*=\s*points_pending_markets\.is_test_market OR EXCLUDED\.is_test_market/,
  );
});

test('protocol_pending_markets is left alone — it has no such column', () => {
  const block = generatorsSrc.slice(generatorsSrc.indexOf('INSERT INTO protocol_pending_markets'));
  const upsertEnd = block.indexOf('RETURNING');
  assert.ok(!block.slice(0, upsertEnd).includes('is_test_market'));
});

test('the public market list exposes the flag', () => {
  assert.match(marketsSrc, /m\.is_test_market/);
  assert.match(marketsSrc, /isTestMarket: r\.is_test_market === true/);
});
