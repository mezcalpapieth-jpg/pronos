/**
 * Static behavior checks for points market cancellation.
 *
 * Run with:
 *   node --test frontend/api/points/admin/cancel-market.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./cancel-market.js', import.meta.url), 'utf8');
const historySource = await readFile(new URL('../history.js', import.meta.url), 'utf8');
const voidSource = await readFile(new URL('./void-market.js', import.meta.url), 'utf8');

test('cancel-market refunds open cost basis and marks the market canceled', () => {
  assert.match(source, /POST \/api\/points\/admin\/cancel-market/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /cannot_cancel_leg_directly/);
  assert.match(source, /market_not_active/);
  assert.match(source, /SELECT id, status, amm_mode, parent_id/);
  assert.match(source, /id = \$1 OR parent_id = \$1/);
  assert.match(source, /points_positions/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /SUM\(cost_basis\)/);
  assert.match(source, /points_balances/);
  assert.match(source, /ON CONFLICT \(username\) DO UPDATE/);
  assert.match(source, /market_cancel_refund/);
  assert.match(source, /status = 'canceled'/);
  assert.match(source, /outcome = NULL/);
  assert.match(source, /shares = 0/);
  assert.match(source, /cost_basis = 0/);
});

test('points history treats cancel refunds as neutral canceled markets', () => {
  assert.match(historySource, /market_cancel_refund/);
  assert.match(historySource, /void_refund/);
  assert.match(historySource, /outcomeStatus = 'canceled'/);
  assert.match(historySource, /marketsCanceled/);
  assert.match(historySource, /side: 'refund'/);
});

test('legacy void-market route uses canceled semantics instead of resolved-without-winner', () => {
  assert.match(voidSource, /POST \/api\/points\/admin\/void-market/);
  assert.match(voidSource, /status = 'canceled'/);
  assert.doesNotMatch(voidSource, /status = 'resolved'/);
  assert.match(voidSource, /void_refund/);
});
