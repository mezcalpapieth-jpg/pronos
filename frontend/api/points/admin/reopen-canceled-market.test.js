/**
 * Static behavior checks for reopening canceled markets into pending review.
 *
 * Run with:
 *   node --test frontend/api/points/admin/reopen-canceled-market.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./reopen-canceled-market.js', import.meta.url), 'utf8');
const marketsSource = await readFile(new URL('./markets.js', import.meta.url), 'utf8');

test('reopen-canceled-market sends canceled parents back to pending review only', () => {
  assert.match(source, /POST \/api\/points\/admin\/reopen-canceled-market/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /market_not_canceled/);
  assert.match(source, /cannot_reopen_leg_directly/);
  assert.match(source, /FROM points_markets/);
  assert.match(source, /status !== 'canceled'/);
  assert.match(source, /FROM points_pending_markets/);
  assert.match(source, /approved_market_id = \$1/);
  assert.match(source, /SET status = 'pending'/);
  assert.match(source, /INSERT INTO points_pending_markets/);
  assert.match(source, /manual-reopen:/);
  assert.match(source, /reopenedFromCanceledMarketId/);
  assert.match(source, /action: 'reopen_canceled_market'/);
  assert.doesNotMatch(source, /UPDATE points_balances/);
  assert.doesNotMatch(source, /UPDATE points_positions/);
  assert.doesNotMatch(source, /INSERT INTO points_trades/);
  assert.doesNotMatch(source, /status = 'active'/);
});

test('admin market list exposes pending restore state for canceled rows', () => {
  assert.match(marketsSource, /pm\.id AS pending_id/);
  assert.match(marketsSource, /pm\.status AS pending_status/);
  assert.match(marketsSource, /pendingId:\s*r\.pending_id \|\| null/);
  assert.match(marketsSource, /pendingStatus:\s*r\.pending_status \|\| null/);
});
