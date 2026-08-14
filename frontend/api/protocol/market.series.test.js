/**
 * Static checks for MVP protocol series detail parity.
 *
 * Run with:
 *   node --test frontend/api/protocol/market.series.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./market.js', import.meta.url), 'utf8');

test('protocol market detail builds series navigation from protocol-owned rows', () => {
  assert.match(source, /buildSeriesDetail/);
  assert.match(source, /normalizeSeriesMeta/);
  assert.match(source, /teamPairKeyFromMeta/);
  assert.match(source, /FROM protocol_markets m/);
  assert.match(source, /FROM protocol_pending_markets p/);
  assert.match(source, /approved_protocol_market_id IS NULL/);
  assert.match(source, /m\.chain_id = \$\{currentRow\.chain_id\}/);
});

test('protocol market detail attaches the sequence to the returned market payload', () => {
  assert.match(source, /const market = buildProtocolMarketPayload\(r\)/);
  assert.match(source, /market\.seriesMeta = seriesMeta/);
});
