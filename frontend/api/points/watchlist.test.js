import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { watchlistMarketId } from './watchlist.js';

test('watchlist validates exact market IDs', () => {
  assert.equal(watchlistMarketId(42), 42);
  assert.equal(watchlistMarketId('2147483647'), 2_147_483_647);
  for (const value of [null, 0, -1, '4x', '1.2', ' 4', '2147483648', {}, ['4'], true]) {
    assert.equal(watchlistMarketId(value), null);
  }
});

test('watchlist migration has a readiness check and writes are scoped and idempotent', async () => {
  const schema = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
  const handler = await readFile(new URL('./watchlist.js', import.meta.url), 'utf8');
  assert.match(schema, /to_regclass\('public\.points_watchlist'\) IS NOT NULL/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS points_watchlist[\s\S]*?PRIMARY KEY \(user_id, market_id\)/);
  assert.match(handler, /WHERE turnkey_sub_org_id = \$\{session\.sub\}/);
  assert.match(handler, /ON CONFLICT \(user_id, market_id\) DO NOTHING/);
  assert.match(handler, /DELETE FROM points_watchlist WHERE user_id = \$\{user\.id\} AND market_id = \$\{marketId\}/);
});
