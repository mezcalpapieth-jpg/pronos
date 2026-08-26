import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./points-trading-service.js', import.meta.url), 'utf8');

test('points trading slippage guards do not coerce omitted values to zero', () => {
  assert.match(source, /import \{ optionalFiniteNumber \} from '\.\/protocol-trade-guards\.js'/);
  assert.match(source, /const minShares = optionalFiniteNumber\(minSharesOut\);/);
  assert.match(source, /const maxPrice = optionalFiniteNumber\(maxAvgPrice\);/);
  assert.match(source, /const minOut = optionalFiniteNumber\(minCollateralOut\);/);

  assert.doesNotMatch(source, /Number\.isFinite\(Number\(minSharesOut\)\)/);
  assert.doesNotMatch(source, /Number\.isFinite\(Number\(maxAvgPrice\)\)/);
  assert.doesNotMatch(source, /Number\.isFinite\(Number\(minCollateralOut\)\)/);
});
