import test from 'node:test';
import assert from 'node:assert/strict';

import { pnlDomain } from './pnlDomain.js';

test('the domain always contains zero, since the baseline is the reference', () => {
  const allPositive = pnlDomain([120, 300, 480]);
  assert.ok(allPositive.min <= 0, `expected min <= 0, got ${allPositive.min}`);

  const allNegative = pnlDomain([-120, -300, -480]);
  assert.ok(allNegative.max >= 0, `expected max >= 0, got ${allNegative.max}`);
});

test('the domain spans both signs when the series crosses zero', () => {
  const d = pnlDomain([136.72, -3437.62, 0]);
  assert.ok(d.min < -3437.62, 'negative extreme should be padded below');
  assert.ok(d.max > 136.72, 'positive extreme should be padded above');
});

test('a flat-zero series still gets a usable domain instead of collapsing', () => {
  const d = pnlDomain([0, 0, 0]);
  assert.ok(d.max > d.min, 'zero-span domain must be widened, not degenerate');
});

test('an empty series falls back to a symmetric domain', () => {
  const d = pnlDomain([]);
  assert.ok(d.min < 0 && d.max > 0);
});

test('non-finite values are ignored rather than poisoning the domain', () => {
  const d = pnlDomain([100, NaN, undefined, null, 250]);
  assert.ok(Number.isFinite(d.min) && Number.isFinite(d.max));
  assert.ok(d.max > 250);
});
