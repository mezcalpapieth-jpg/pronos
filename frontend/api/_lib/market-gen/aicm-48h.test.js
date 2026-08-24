import test from 'node:test';
import assert from 'node:assert/strict';

import { generateAicm48hMarkets, AICM_48H_THRESHOLD_MIN } from './aicm-48h.js';
import { aicmAeBucketIndexFor } from '../aicm-aviation-edge.js';

test('generateAicm48hMarkets targets the coming Thursday and Friday', async () => {
  // Wednesday 2026-08-19, midday in Mexico City.
  const [market] = await generateAicm48hMarkets({ now: new Date('2026-08-19T18:00:00Z') });

  assert.equal(market.resolver_config.fromDateYmd, '2026-08-20');
  assert.equal(market.resolver_config.toDateYmd, '2026-08-21');
  assert.equal(market.resolver_type, 'aicm_delay_minutes_live');
  assert.equal(market.source_event_id, 'aicm:MEX:departure:48h:2026-08-20');
  assert.equal(market.amm_mode, 'parallel');
  assert.equal(market.category, 'infraestructura');
});

test('the counted window never includes the day the market opens', async () => {
  // Opening midday Thursday must not count that same Thursday: half its
  // flights have already departed and their delays are public.
  const [market] = await generateAicm48hMarkets({ now: new Date('2026-08-20T18:00:00Z') });
  assert.equal(market.resolver_config.fromDateYmd, '2026-08-27');
  assert.ok(market.resolver_config.fromDateYmd > '2026-08-20');
});

test('trading closes exactly when the counted window closes', async () => {
  const [market] = await generateAicm48hMarkets({ now: new Date('2026-08-19T18:00:00Z') });
  const end = new Date(market.end_time);
  // Friday 23:59:59 in Mexico City is 05:59:59 UTC on Saturday (UTC-6, no DST).
  assert.equal(end.toISOString(), '2026-08-22T05:59:59.000Z');
});

test('outcomes match the calibrated 48h buckets and cover every count', async () => {
  const [market] = await generateAicm48hMarkets({ now: new Date('2026-08-19T18:00:00Z') });
  assert.deepEqual(market.outcomes, ['0-199', '200-230', '231-260', '261+']);

  const buckets = market.resolver_config.buckets;
  assert.equal(aicmAeBucketIndexFor(266, buckets), 3);
  for (const n of [0, 199, 200, 260, 261, 1000]) {
    assert.ok(aicmAeBucketIndexFor(n, buckets) >= 0, `count ${n} fell outside every bucket`);
  }
});

test('resolver config carries the completeness guards', async () => {
  const [market] = await generateAicm48hMarkets({ now: new Date('2026-08-19T18:00:00Z') });
  const cfg = market.resolver_config;
  assert.equal(cfg.thresholdMinutes, AICM_48H_THRESHOLD_MIN);
  assert.equal(cfg.direction, 'departure');
  assert.equal(cfg.airportCode, 'MEX');
  // A real jue+vie carries ~857 operator flights; the floor catches a
  // thin poll log without tripping on a quiet week.
  assert.ok(cfg.minOperatorFlights > 0 && cfg.minOperatorFlights < 857);
  assert.ok(cfg.minOkPolls > 0);
  // Saturday 04:00 in Mexico City is 10:00 UTC (UTC-6, no DST).
  assert.equal(cfg.resolveAfterUtc, '2026-08-22T10:00:00.000Z');
});

test('criteria spell out codeshares, cancellations and the resolution lag', async () => {
  const [market] = await generateAicm48hMarkets({ now: new Date('2026-08-19T18:00:00Z') });
  const criteria = market.resolver_config.criteria;
  assert.match(criteria, /30 minutos/);
  assert.match(criteria, /compartidos/);
  assert.match(criteria, /cancelados/);
  assert.match(criteria, /04:00/);
  assert.equal(market.source_data.resolutionCriteria, criteria);
});

test('generateAicm48hMarkets yields nothing once the window has closed', async () => {
  const markets = await generateAicm48hMarkets({
    now: new Date('2026-08-19T18:00:00Z'),
    fromDateYmd: '2026-08-06',
  });
  assert.deepEqual(markets, []);
});
