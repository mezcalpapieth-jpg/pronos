import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./history.js', import.meta.url), 'utf8');

test('points history exposes parent market ids for portfolio detail links', () => {
  assert.match(source, /m\.parent_id/);
  assert.match(source, /pm\.id AS parent_market_id/);
  assert.match(source, /LEFT JOIN points_markets pm ON pm\.id = m\.parent_id/);
  assert.match(source, /parentMarketId:\s*r\.parent_market_id\s*\|\|\s*null/);
  assert.match(source, /parentMarketId:\s*m\.parentMarketId/);
});
