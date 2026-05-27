import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runWithConcurrency,
  shouldKeepPreviousNewsCache,
} from './news-mexico.js';

test('news refresh keeps a fuller cache when a refresh collapses to one outlet', () => {
  assert.equal(shouldKeepPreviousNewsCache({
    previousCount: 120,
    nextCount: 20,
    failedOutlets: 18,
    totalOutlets: 19,
  }), true);

  assert.equal(shouldKeepPreviousNewsCache({
    previousCount: 0,
    nextCount: 20,
    failedOutlets: 18,
    totalOutlets: 19,
  }), false);

  assert.equal(shouldKeepPreviousNewsCache({
    previousCount: 120,
    nextCount: 96,
    failedOutlets: 2,
    totalOutlets: 19,
  }), false);
});

test('news outlet refresh runs with bounded concurrency', async () => {
  let active = 0;
  let maxActive = 0;

  const results = await runWithConcurrency([1, 2, 3, 4, 5], async value => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 8));
    active -= 1;
    return value * 10;
  }, 2);

  assert.deepEqual(results, [10, 20, 30, 40, 50]);
  assert.equal(maxActive <= 2, true);
});
