import test from 'node:test';
import assert from 'node:assert/strict';
import { orderPointsMarkets } from './pointsMarketOrdering.js';

const markets = [
  { id: 'undated', volume: 1_000 },
  { id: 'early', status: 'active', endTime: '2026-11-18', createdAt: '2026-11-02', tradeVolume: 0 },
  { id: 'late', status: 'active', endTime: '2026-12-18', createdAt: '2026-11-15', tradeVolume: 20 },
  { id: 'ended', status: 'resolved', endTime: '2026-10-02', tradeVolume: 20 },
];

test('Points market sort uses true turnover and leaves ties in the grid default order', () => {
  assert.deepEqual(orderPointsMarkets(markets, 'volume').map(m => m.id), ['late', 'ended', 'early', 'undated']);
  assert.equal(orderPointsMarkets(markets, 'trending'), markets);
  assert.equal(orderPointsMarkets(markets, 'invalid'), markets);
});

test('Points market sort uses real creation and close dates, with missing values last', () => {
  assert.deepEqual(orderPointsMarkets(markets, 'new').map(m => m.id), ['late', 'early', 'undated', 'ended']);
  assert.deepEqual(orderPointsMarkets(markets, 'closing', Date.parse('2026-11-17')).map(m => m.id), ['early', 'late', 'ended', 'undated']);
});
