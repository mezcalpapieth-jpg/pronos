import test from 'node:test';
import assert from 'node:assert/strict';
import { aviationEdgeEnabled, aviationEdgeReadiness, assertPointsAirportApproval, disabledPointsGenerators, isAviationEdgeMarket } from './points-aicm-policy.js';

const now = new Date('2026-11-04T19:30:00Z');
const enabled = { POINTS_AVIATION_EDGE_ENABLED: 'true', AVIATION_EDGE_KEY: 'test-key' };
const market = { source: 'aviation-edge-timetable', resolver_type: 'aicm_delay_minutes_live' };

test('retained credentials do not reactivate a canceled subscription', async () => {
  const env = { AVIATION_EDGE_KEY: 'retained-key' };
  assert.equal(aviationEdgeEnabled(env), false);
  assert.deepEqual(disabledPointsGenerators(env), ['aicm', 'aicm-48h']);
  await assert.rejects(assertPointsAirportApproval({ query: () => assert.fail('disabled source must not query') }, market, { env, now }), { message: 'aviation_edge_disabled', status: 409 });
});

test('airport approval requires explicit enablement, credentials and a recent successful departure poll', async () => {
  for (const latestRun of [null, { status: 'fetch_error', observed_at: now }, { status: 'ok', observed_at: '2026-11-04T18:00:00Z' }, { status: 'ok', observed_at: '2026-11-05T19:30:00Z' }]) {
    assert.equal(aviationEdgeReadiness({ env: enabled, now, latestRun }).ready, false);
    await assert.rejects(assertPointsAirportApproval({ query: async () => ({ rows: latestRun ? [latestRun] : [] }) }, market, { env: enabled, now }), { message: 'aviation_edge_unhealthy' });
  }
  assert.equal(aviationEdgeReadiness({ env: { POINTS_AVIATION_EDGE_ENABLED: 'true' }, now }).reason, 'aviation_edge_key_missing');
  await assertPointsAirportApproval({ query: async sql => {
    assert.match(sql, /direction = 'departure'/);
    return { rows: [{ status: 'ok', observed_at: '2026-11-04T19:10:00Z' }] };
  } }, market, { env: enabled, now });
});

test('unrelated markets bypass airport checks and legacy airport identities stay guarded', async () => {
  await assertPointsAirportApproval({ query: () => assert.fail('unrelated source') }, { source: 'espn' }, { env: {}, now });
  assert.equal(isAviationEdgeMarket({ resolver_config: { source: 'aviation-edge-timetable' } }), true);
  assert.equal(isAviationEdgeMarket({ source: 'aicm-official-flight-board' }), true);
});

test('disabled timetable cron returns a no-op without fetching or touching the database', async () => {
  const keys = ['DATABASE_URL', 'CRON_SECRET', 'VERCEL_ENV', 'POINTS_AVIATION_EDGE_ENABLED', 'AVIATION_EDGE_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.DATABASE_URL = 'postgresql://test:test@example.invalid/neondb';
    process.env.CRON_SECRET = 'test-cron';
    process.env.AVIATION_EDGE_KEY = 'retained-key';
    delete process.env.POINTS_AVIATION_EDGE_ENABLED;
    globalThis.fetch = () => assert.fail('disabled source must not fetch');
    const { default: handler } = await import('../cron/aicm-timetable-poll.js');
    const res = { code: null, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'GET', headers: { authorization: 'Bearer test-cron' }, query: {} }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(res.body, { ok: true, skipped: true, reason: 'aviation_edge_disabled' });
    await handler({ method: 'GET', headers: {}, query: {} }, res);
    assert.equal(res.code, 401);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});
