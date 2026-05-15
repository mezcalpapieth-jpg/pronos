import test from 'node:test';
import assert from 'node:assert/strict';

import { formatDirectionFinalScore, resolveDirectionOutcome } from './crypto-5min.js';

test('resolveDirectionOutcome maps a close above threshold to SUBE and below threshold to BAJA', () => {
  assert.equal(resolveDirectionOutcome(100_001, 100_000), 0);
  assert.equal(resolveDirectionOutcome(99_999, 100_000), 1);
});

test('resolveDirectionOutcome returns null for an exact tie', () => {
  assert.equal(resolveDirectionOutcome(100_000, 100_000), null);
});

test('formatDirectionFinalScore mirrors the existing crypto final-score label', () => {
  assert.equal(formatDirectionFinalScore(100000, 100123.456), '$100000 -> $100123.46');
});
