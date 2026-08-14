/**
 * Static behavior checks for UFC parallel-to-binary conversion.
 *
 * Run with:
 *   node --test frontend/api/points/admin/convert-parallel-binary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./convert-parallel-binary.js', import.meta.url), 'utf8');

test('convert-parallel-binary is an admin-only guarded UFC repair route', () => {
  assert.match(source, /POST \/api\/points\/admin\/convert-parallel-binary/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /withTransaction/);
  assert.match(source, /market_not_parallel/);
  assert.match(source, /cfg\?\.source !== 'espn-mma'/);
  assert.match(source, /Expected exactly two active child legs/);
});

test('convert-parallel-binary ignores historical trades but refuses current exposure', () => {
  assert.match(source, /points_trades/);
  assert.match(source, /points_limit_orders/);
  assert.match(source, /points_positions/);
  assert.match(source, /ACTIVE_POSITION_SHARE_EPSILON = 0\.5/);
  assert.match(source, /PRONOS_TREASURY_USERNAME/);
  assert.match(source, /hasCurrentPublicExposure/);
  assert.match(source, /parallel_market_has_exposure/);
  assert.match(source, /ABS\(COALESCE\(shares, 0\)\) >= \$3/);
  assert.doesNotMatch(source, /counts\.trades > 0/);
  assert.doesNotMatch(source, /cost_basis > 0/);
  assert.match(source, /Cancel\/refund this market and create a fresh binary version instead/);
});

test('convert-parallel-binary switches parent to unified binary and retires legs', () => {
  assert.match(source, /binaryPrices/);
  assert.match(source, /seedLiquiditiesFromProbabilities/);
  assert.match(source, /shape: 'binary'/);
  assert.match(source, /amm_mode = 'unified'/);
  assert.match(source, /delete nextResolverConfig\.legs/);
  assert.match(source, /releaseOpenLimitOrdersForMarkets/);
  assert.match(source, /status = 'canceled'/);
  assert.match(source, /convertedFromParallel/);
});

test('convert-parallel-binary keeps metadata on pending rows, not points_markets', () => {
  assert.match(source, /FROM points_pending_markets/);
  assert.match(source, /approved_market_id = \$1/);
  assert.match(source, /SET source_data = \$2::jsonb/);
  assert.doesNotMatch(source, /source_data, sport/);
  assert.doesNotMatch(source, /source_data = \$6::jsonb/);
});
