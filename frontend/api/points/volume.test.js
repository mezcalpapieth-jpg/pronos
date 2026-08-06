/**
 * Run with:
 *   node --test frontend/api/points/volume.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const marketListSource = await readFile(new URL('./markets.js', import.meta.url), 'utf8');
const marketDetailSource = await readFile(new URL('./market.js', import.meta.url), 'utf8');
const statsSource = await readFile(new URL('./stats.js', import.meta.url), 'utf8');
const activitySource = await readFile(new URL('./trade-activity.js', import.meta.url), 'utf8');
const ogMarketSource = await readFile(new URL('../og/market.js', import.meta.url), 'utf8');

test('points volume is additive traded collateral, never signed net flow', () => {
  for (const source of [marketListSource, marketDetailSource, statsSource, activitySource, ogMarketSource]) {
    assert.match(source, /SUM\(ABS\(collateral\)\)/);
    assert.doesNotMatch(source, /SUM\(collateral\)/);
  }
});

test('points market detail exposes latest trade timestamp separately from selected chart range', () => {
  assert.match(marketDetailSource, /MAX\(created_at\) FROM points_trades/);
  assert.match(marketDetailSource, /AS last_trade_at/);
  assert.match(marketDetailSource, /lastTradeAt: r\.last_trade_at/);
});
