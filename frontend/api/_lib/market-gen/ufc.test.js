import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './ufc.js';

test('UFC date filter keeps only fights inside the two-week import window', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  assert.equal(_internal.shouldKeepFightDate('2026-05-29T11:59:59.000Z', now), true);
  assert.equal(_internal.shouldKeepFightDate('2026-05-29T12:01:00.000Z', now), false);
  assert.equal(_internal.shouldKeepFightDate('2027-01-01T03:57:00.000Z', now), false);
});
