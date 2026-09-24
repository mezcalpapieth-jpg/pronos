import test from 'node:test';
import assert from 'node:assert/strict';

import { priceBucketIndexFor } from './price-buckets.js';

test('priceBucketIndexFor treats exact boundaries as the upper bucket', () => {
  const buckets = [
    { label: '< 10', max: 10 },
    { label: '10 to 20', min: 10, max: 20 },
    { label: '20+', min: 20 },
  ];

  assert.equal(priceBucketIndexFor(9.99, buckets), 0);
  assert.equal(priceBucketIndexFor(10, buckets), 1);
  assert.equal(priceBucketIndexFor(19.999, buckets), 1);
  assert.equal(priceBucketIndexFor(20, buckets), 2);
});

test('priceBucketIndexFor rejects invalid prices and uncovered ranges', () => {
  assert.equal(priceBucketIndexFor('nope', [{ max: 10 }]), -1);
  assert.equal(priceBucketIndexFor(15, [{ max: 10 }, { min: 20 }]), -1);
});
