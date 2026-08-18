import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptiveBuckets,
  weatherBucketIndexFor,
  weatherResolutionCriteriaForBuckets,
} from './weather.js';

test('weather adaptive buckets use one-degree floor ranges', () => {
  const buckets = adaptiveBuckets(25.6);

  assert.deepEqual(
    buckets.map(b => b.label),
    ['< 25°C', '25°C', '26°C', '≥ 27°C'],
  );
  assert.equal(weatherBucketIndexFor(24.99, buckets), 0);
  assert.equal(weatherBucketIndexFor(25, buckets), 1);
  assert.equal(weatherBucketIndexFor(25.99, buckets), 1);
  assert.equal(weatherBucketIndexFor(26, buckets), 2);
  assert.equal(weatherBucketIndexFor(26.99, buckets), 2);
  assert.equal(weatherBucketIndexFor(27, buckets), 3);
});

test('weather criteria explains exact non-rounded bucket boundaries', () => {
  const criteria = weatherResolutionCriteriaForBuckets(adaptiveBuckets(25.6));

  assert.match(criteria, /< 25°C gana con cualquier valor menor a 25\.00°C/);
  assert.match(criteria, /25°C gana desde 25\.00°C hasta 25\.99°C/);
  assert.match(criteria, /26°C gana desde 26\.00°C hasta 26\.99°C/);
  assert.match(criteria, /≥ 27°C gana con 27\.00°C o más/);
});
