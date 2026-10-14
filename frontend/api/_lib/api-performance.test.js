import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedJson } from './api-performance.js';

test('a slow producer receives its full cache lifetime after completion', async t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const key = Symbol('slow-read');
  let reads = 0;
  const produce = () => { reads += 1; now += 100; return reads; };
  assert.deepEqual(await cachedJson(key, 15, produce), { value: 1, hit: false });
  now = 114;
  assert.deepEqual(await cachedJson(key, 15, produce), { value: 1, hit: true });
  now = 115;
  assert.deepEqual(await cachedJson(key, 15, produce), { value: 2, hit: false });
});

test('simultaneous requests share one read and failed reads can retry', async () => {
  const key = Symbol('concurrent-read');
  let reads = 0;
  let finish;
  const produce = () => { reads += 1; return new Promise(resolve => { finish = resolve; }); };
  const first = cachedJson(key, 1000, produce);
  const second = cachedJson(key, 1000, produce);
  await Promise.resolve();
  assert.equal(reads, 1);
  finish({ score: 20 });
  assert.deepEqual(await first, { value: { score: 20 }, hit: false });
  assert.deepEqual(await second, { value: { score: 20 }, hit: true });
  const failedKey = Symbol('failed-read');
  const broken = () => { throw new Error('read failed'); };
  await assert.rejects(Promise.all([
    cachedJson(failedKey, 1000, broken), cachedJson(failedKey, 1000, broken),
  ]), /read failed/);
  assert.deepEqual(await cachedJson(failedKey, 1000, () => 30), { value: 30, hit: false });
});

test('uncached reads remain independent', async () => {
  const key = Symbol('uncached-read');
  let reads = 0;
  const values = await Promise.all([
    cachedJson(key, 0, () => ++reads), cachedJson(key, 0, () => ++reads),
  ]);
  assert.deepEqual(values, [{ value: 1, hit: false }, { value: 2, hit: false }]);
});
