import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AICM_AE_DAILY_DELAY_BUCKETS,
  AICM_AE_48H_DELAY_BUCKETS,
  aicmAeBucketIndexFor,
  aicmAeHistoryReady,
  aicmAeMaxAvailableYmd,
  buildAicmAeDelayBucketsForDays,
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
  assert.equal(aicmAeBucketIndexFor(0), 0);
  assert.equal(aicmAeBucketIndexFor(199), 0);
  assert.equal(aicmAeBucketIndexFor(200), 1);
  assert.equal(aicmAeBucketIndexFor(230), 1);
  assert.equal(aicmAeBucketIndexFor(231), 2);
  assert.equal(aicmAeBucketIndexFor(260), 2);
  assert.equal(aicmAeBucketIndexFor(261), 3);
  assert.equal(aicmAeBucketIndexFor(9999), 3);
  assert.equal(aicmAeBucketIndexFor(-1), -1);
  assert.equal(aicmAeBucketIndexFor('nope'), -1);
});

test('daily AICM buckets cover the realistic 30+ minute day range', () => {
  assert.equal(aicmAeBucketIndexFor(0, AICM_AE_DAILY_DELAY_BUCKETS), 0);
  assert.equal(aicmAeBucketIndexFor(99, AICM_AE_DAILY_DELAY_BUCKETS), 0);
  assert.equal(aicmAeBucketIndexFor(100, AICM_AE_DAILY_DELAY_BUCKETS), 1);
  assert.equal(aicmAeBucketIndexFor(115, AICM_AE_DAILY_DELAY_BUCKETS), 1);
  assert.equal(aicmAeBucketIndexFor(116, AICM_AE_DAILY_DELAY_BUCKETS), 2);
  assert.equal(aicmAeBucketIndexFor(130, AICM_AE_DAILY_DELAY_BUCKETS), 2);
  assert.equal(aicmAeBucketIndexFor(131, AICM_AE_DAILY_DELAY_BUCKETS), 3);
  assert.equal(aicmAeBucketIndexFor(9999, AICM_AE_DAILY_DELAY_BUCKETS), 3);
});

test('AICM 30+ minute buckets scale by counted days', () => {
  assert.deepEqual(AICM_AE_DAILY_DELAY_BUCKETS.map(b => b.label), ['0-99', '100-115', '116-130', '131+']);
  assert.deepEqual(AICM_AE_48H_DELAY_BUCKETS.map(b => b.label), ['0-199', '200-230', '231-260', '261+']);
  assert.deepEqual(buildAicmAeDelayBucketsForDays(3).map(b => b.label), ['0-299', '300-345', '346-390', '391+']);
});

test('the 48h buckets leave no gap and no overlap', () => {
  for (let n = 0; n <= 400; n += 1) {
    const hits = AICM_AE_48H_DELAY_BUCKETS.filter((b) => (
      n >= b.minCount && (b.maxCount == null || n <= b.maxCount)
    ));
    assert.equal(hits.length, 1, `count ${n} matched ${hits.length} buckets`);
  }
});

test('the daily buckets leave no gap and no overlap', () => {
  for (let n = 0; n <= 240; n += 1) {
    const hits = AICM_AE_DAILY_DELAY_BUCKETS.filter((b) => (
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
