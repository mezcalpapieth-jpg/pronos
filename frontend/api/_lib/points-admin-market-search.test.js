import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdminMarketSearch } from './points-admin-market-search.js';

test('admin market search folds accents and preserves literal event IDs', () => {
  assert.deepEqual(parseAdminMarketSearch(' Inflación en MÉXICO '), { id: null, text: 'inflacion en mexico' });
  assert.deepEqual(parseAdminMarketSearch(' ESPN_406% '), { id: null, text: 'espn_406%' });
  assert.deepEqual(parseAdminMarketSearch(['first', 'second']), { id: null, text: null });
});

test('a hash-prefixed market ID is exact and stays within the PostgreSQL integer range', () => {
  assert.deepEqual(parseAdminMarketSearch('#00042'), { id: 42, text: null });
  assert.deepEqual(parseAdminMarketSearch('#2147483648'), { id: null, text: '#2147483648' });
  assert.deepEqual(parseAdminMarketSearch('42'), { id: null, text: '42' });
});
