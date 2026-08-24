import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AICM_AE_48H_DELAY_BUCKETS,
  aicmAeBucketIndexFor,
  aicmAeHistoryReady,
  aicmAeMaxAvailableYmd,
  buildAicmAeHistoryUrl,
  readAicmAeDelayCount,
  summarizeAicmAeDelays,
} from './aicm-aviation-edge.js';

function flight({
  scheduled, delay = null, status = 'active', codeshared = null,
}) {
  return {
    status,
    codeshared,
    departure: { iataCode: 'mex', scheduledTime: scheduled, delay },
  };
}

test('buildAicmAeHistoryUrl widens the range by a day on each side', () => {
  const url = new URL(buildAicmAeHistoryUrl({
    fromDateYmd: '2026-08-20',
    toDateYmd: '2026-08-21',
    apiKey: 'k',
  }));
  assert.equal(url.searchParams.get('code'), 'MEX');
  assert.equal(url.searchParams.get('type'), 'departure');
  // The feed filters on UTC but reports local time, so the requested window
  // must overshoot or the edge days come back truncated.
  assert.equal(url.searchParams.get('date_from'), '2026-08-19');
  assert.equal(url.searchParams.get('date_to'), '2026-08-22');
});

test('buildAicmAeHistoryUrl requires a key and a range', () => {
  assert.throws(() => buildAicmAeHistoryUrl({ fromDateYmd: '2026-08-20', toDateYmd: '2026-08-21' }), /api_key/);
  assert.throws(() => buildAicmAeHistoryUrl({ apiKey: 'k' }), /date_range/);
});

test('summarizeAicmAeDelays counts only operator flights past the threshold', () => {
  const out = summarizeAicmAeDelays([
    flight({ scheduled: '2026-08-20t06:00:00.000', delay: 45 }),   // late
    flight({ scheduled: '2026-08-20t07:00:00.000', delay: 30 }),   // exactly 30, not late
    flight({ scheduled: '2026-08-20t08:00:00.000', delay: 31 }),   // late
    flight({ scheduled: '2026-08-20t09:00:00.000', delay: null }), // on time
    flight({ scheduled: '2026-08-21t10:00:00.000', delay: 90 }),   // late
  ], { fromDateYmd: '2026-08-20', toDateYmd: '2026-08-21' });

  assert.equal(out.count, 3);
  assert.equal(out.operatorFlights, 5);
  assert.equal(out.withoutDelay, 1);
  assert.deepEqual(out.daysCovered, ['2026-08-20', '2026-08-21']);
  assert.deepEqual(out.perDay, [
    { dateYmd: '2026-08-20', flights: 4, late: 2 },
    { dateYmd: '2026-08-21', flights: 1, late: 1 },
  ]);
});

test('summarizeAicmAeDelays drops codeshares, which are two thirds of the feed', () => {
  const out = summarizeAicmAeDelays([
    flight({ scheduled: '2026-08-20t06:00:00.000', delay: 45 }),
    flight({ scheduled: '2026-08-20t06:00:00.000', delay: 45, codeshared: { airline: { iataCode: 'am' } } }),
    flight({ scheduled: '2026-08-20t06:00:00.000', delay: 45, codeshared: { airline: { iataCode: 'dl' } } }),
  ], { fromDateYmd: '2026-08-20', toDateYmd: '2026-08-20' });

  assert.equal(out.operatorFlights, 1);
  assert.equal(out.count, 1);
});

test('summarizeAicmAeDelays excludes cancelled flights and days outside the window', () => {
  const out = summarizeAicmAeDelays([
    flight({ scheduled: '2026-08-19t22:00:00.000', delay: 120 }),                     // day before
    flight({ scheduled: '2026-08-22t01:00:00.000', delay: 120 }),                     // day after
    flight({ scheduled: '2026-08-20t06:00:00.000', delay: 120, status: 'cancelled' }), // never departed
    flight({ scheduled: '2026-08-20t07:00:00.000', delay: 61 }),
  ], { fromDateYmd: '2026-08-20', toDateYmd: '2026-08-21' });

  assert.equal(out.count, 1);
  assert.equal(out.cancelled, 1);
  assert.equal(out.operatorFlights, 2);
});

test('aicmAeBucketIndexFor maps counts onto the 48h buckets', () => {
  assert.equal(AICM_AE_48H_DELAY_BUCKETS.length, 8);
  assert.equal(aicmAeBucketIndexFor(0), 0);
  assert.equal(aicmAeBucketIndexFor(255), 0);
  assert.equal(aicmAeBucketIndexFor(256), 1);
  assert.equal(aicmAeBucketIndexFor(265), 1);
  assert.equal(aicmAeBucketIndexFor(275), 2);
  assert.equal(aicmAeBucketIndexFor(285), 3);
  assert.equal(aicmAeBucketIndexFor(295), 4);
  assert.equal(aicmAeBucketIndexFor(310), 5);
  assert.equal(aicmAeBucketIndexFor(330), 6);
  assert.equal(aicmAeBucketIndexFor(331), 7);
  assert.equal(aicmAeBucketIndexFor(9999), 7);
  assert.equal(aicmAeBucketIndexFor(-1), -1);
  assert.equal(aicmAeBucketIndexFor('nope'), -1);
});

test('every historical jue+vie window lands in a bucket', () => {
  // The 13 real windows the bands were drawn from.
  for (const n of [248, 252, 257, 263, 266, 277, 280, 283, 288, 305, 308, 334, 336]) {
    assert.ok(aicmAeBucketIndexFor(n) >= 0, `window of ${n} fell outside every bucket`);
  }
});

test('the 48h buckets leave no gap and no overlap', () => {
  for (let n = 0; n <= 500; n += 1) {
    const hits = AICM_AE_48H_DELAY_BUCKETS.filter((b) => (
      n >= b.minCount && (b.maxCount == null || n <= b.maxCount)
    ));
    assert.equal(hits.length, 1, `count ${n} matched ${hits.length} buckets`);
  }
});

test('history readiness follows the 3-day publication lag', () => {
  const now = new Date('2026-08-19T18:00:00Z');
  assert.equal(aicmAeMaxAvailableYmd(now), '2026-08-16');
  assert.equal(aicmAeHistoryReady({ toDateYmd: '2026-08-16', now }), true);
  assert.equal(aicmAeHistoryReady({ toDateYmd: '2026-08-17', now }), false);
  assert.equal(aicmAeHistoryReady({ toDateYmd: '2026-08-21', now }), false);
});

test('readAicmAeDelayCount refuses a window the archive has not published yet', async () => {
  await assert.rejects(
    () => readAicmAeDelayCount({
      fromDateYmd: '2026-08-20',
      toDateYmd: '2026-08-21',
      apiKey: 'k',
      now: new Date('2026-08-22T05:00:00Z'),
      fetchImpl: () => assert.fail('must not call the API before the lag clears'),
    }),
    (err) => {
      assert.equal(err.message, 'aicm_ae_history_not_ready');
      // Benign so the resolver retries later instead of failing the market.
      assert.equal(err.benign, true);
      assert.equal(err.info.maxAvailableYmd, '2026-08-19');
      return true;
    },
  );
});

test('readAicmAeDelayCount counts a published window', async () => {
  const out = await readAicmAeDelayCount({
    fromDateYmd: '2026-08-20',
    toDateYmd: '2026-08-21',
    apiKey: 'k',
    now: new Date('2026-08-25T05:00:00Z'),
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        flight({ scheduled: '2026-08-20t06:00:00.000', delay: 45 }),
        flight({ scheduled: '2026-08-21t06:00:00.000', delay: 90 }),
        flight({ scheduled: '2026-08-21t07:00:00.000', delay: 5 }),
      ],
    }),
  });
  assert.equal(out.count, 2);
  assert.equal(out.thresholdMinutes, 30);
});

test('readAicmAeDelayCount surfaces an API-level error payload', async () => {
  await assert.rejects(
    () => readAicmAeDelayCount({
      fromDateYmd: '2026-08-20',
      toDateYmd: '2026-08-21',
      apiKey: 'k',
      now: new Date('2026-08-25T05:00:00Z'),
      fetchImpl: async () => ({ ok: true, json: async () => ({ error: 'no record found' }) }),
    }),
    /aicm_ae_api_error/,
  );
});
