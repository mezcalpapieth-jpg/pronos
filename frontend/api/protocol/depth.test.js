import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./depth.js', import.meta.url), 'utf8');

test('protocol depth route exposes a read-only AMM ladder endpoint', () => {
  assert.match(source, /GET \/api\/protocol\/depth/);
  assert.match(source, /methods:\s*'GET, OPTIONS'/);
  assert.match(source, /buildAmmDepth/);
  assert.match(source, /quoteBuyOnChain/);
  assert.match(source, /quoteSellOnChain/);
  assert.match(source, /normalizeDepthLevels/);
});

test('protocol depth route validates market state before quoting', () => {
  assert.match(source, /FROM protocol_markets/);
  assert.match(source, /market_not_found/);
  assert.match(source, /market_closed/);
  assert.match(source, /market_expired/);
  assert.match(source, /market_missing_pool/);
  assert.match(source, /invalid_outcome_index/);
});

test('protocol depth route keeps optional playoff games locked like buy quotes', () => {
  assert.match(source, /seriesTradeLockFromRows/);
  assert.match(source, /series_game_not_needed/);
  assert.match(source, /series_game_pending/);
});
