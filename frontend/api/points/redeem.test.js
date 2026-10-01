import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./redeem.js', import.meta.url), 'utf8');

test('redeem is gated to shares from the active scoring window', () => {
  assert.match(source, /readActiveCycleWindow\(client\)/);
  assert.match(source, /scoringStartIsoForWindow\(activeWindow\)/);
  assert.match(source, /position_outside_current_cycle/);
  assert.match(source, /current_cycle_shares/);
  assert.match(source, /created_at >= \$4::timestamptz/);
  assert.match(source, /side IN \('buy', 'sell', 'redeem'\)/);
  assert.match(source, /redeemShares = Math\.min\(shares, currentCycleShares\)/);
});

test('redeem does not pay stale reset remainders', () => {
  assert.match(source, /remainingShares = Math\.max\(0, shares - redeemShares\)/);
  assert.match(source, /staleRemainder/);
  assert.match(source, /dismissed_at = CASE WHEN \$4::boolean THEN COALESCE\(dismissed_at, NOW\(\)\) ELSE dismissed_at END/);
  assert.match(source, /Cobro de \$\{redeemShares\.toFixed\(2\)\} acciones ganadoras/);
});
