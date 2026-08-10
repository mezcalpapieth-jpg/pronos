/**
 * Run with:
 *   node --test frontend/api/_lib/points-sell-shares.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExecutableSellShares } from './points-sell-shares.js';

test('normalizeExecutableSellShares snaps full-position display rounding to the available amount', () => {
  const result = normalizeExecutableSellShares({
    requestedShares: 184.75,
    heldShares: 184.746721,
    reservedShares: 0,
  });

  assert.equal(result.sharesToSell, 184.746721);
  assert.equal(result.availableShares, 184.746721);
});

test('normalizeExecutableSellShares still blocks real reserved-share conflicts', () => {
  assert.throws(
    () => normalizeExecutableSellShares({
      requestedShares: 184.75,
      heldShares: 184.75,
      reservedShares: 0.05,
    }),
    /insufficient_available_shares/,
  );
});

test('normalizeExecutableSellShares keeps ordinary partial sells unchanged', () => {
  const result = normalizeExecutableSellShares({
    requestedShares: 184.74,
    heldShares: 184.746721,
    reservedShares: 0,
  });

  assert.equal(result.sharesToSell, 184.74);
});
