import test from 'node:test';
import assert from 'node:assert/strict';

process.env.POINTS_RISK_SALT = 'test-risk-salt-that-is-long-enough';

const {
  capturePointsRiskEvent,
  hashRiskSignal,
  normalizeRiskReviewStatus,
  pointsRiskSignals,
  safeRiskMetadata,
} = await import('./points-risk.js');

test('risk signals are hashed and do not expose raw request identifiers', () => {
  const req = {
    headers: {
      'x-forwarded-for': '203.0.113.44, 10.0.0.1',
      'user-agent': 'Risk Test Browser',
      'x-pronos-device-id': 'device-123',
      cookie: 'pronos_points_session=session-token-123',
    },
  };
  const signals = pointsRiskSignals(req);
  assert.equal(signals.ipHash, hashRiskSignal('203.0.113.44'));
  assert.equal(signals.userAgentHash, hashRiskSignal('Risk Test Browser'));
  assert.equal(signals.deviceHash, hashRiskSignal('device-123'));
  assert.equal(signals.sessionHash, hashRiskSignal('session-token-123'));
  for (const value of Object.values(signals)) {
    assert.equal(typeof value, 'string');
    assert.equal(value.length, 64);
    assert.doesNotMatch(value, /203\.0\.113|Risk Test Browser|device-123|session-token/);
  }
});

test('risk metadata drops direct PII-like keys and accepts only known review statuses', () => {
  const safe = safeRiskMetadata({
    ip: '203.0.113.44',
    ipAddress: '203.0.113.45',
    userAgent: 'Browser',
    cookie: 'abc',
    session: 'def',
    sessionCookie: 'ghi',
    token: 'jkl',
    priceBefore: 0.5,
  });
  assert.deepEqual(safe, { priceBefore: 0.5 });
  assert.equal(normalizeRiskReviewStatus('WATCH'), 'watch');
  assert.equal(normalizeRiskReviewStatus('phone_required'), 'phone_required');
  assert.equal(normalizeRiskReviewStatus('ban'), null);
});

test('risk capture supports Neon tagged clients without blocking callers', async () => {
  const calls = [];
  async function sql(strings, ...values) {
    calls.push({ strings, values });
    return [];
  }
  await capturePointsRiskEvent(sql, {
    headers: {
      'x-forwarded-for': '203.0.113.44',
      'user-agent': 'Risk Test Browser',
      cookie: 'pronos_points_session=session-token-123',
    },
  }, {
    username: 'frmm',
    accountId: 'turnkey-account',
    eventType: 'trade:buy',
    marketId: '12',
    tradeSide: 'buy',
    outcomeIndex: '1',
    amount: '100',
    shares: '196.08',
    metadata: { userAgent: 'raw browser', priceAfter: 0.51 },
  });
  assert.equal(calls.length, 1);
  const [{ strings, values }] = calls;
  assert.match(strings.join('?'), /INSERT INTO points_risk_events/);
  assert.equal(values[0], 'frmm');
  assert.equal(values[2], 'trade:buy');
  assert.equal(values[3], 12);
  assert.equal(values[5], 1);
  assert.equal(values[6], 100);
  assert.equal(values[7], 196.08);
  assert.deepEqual(JSON.parse(values[12]), { priceAfter: 0.51 });
});

test('risk capture also supports transaction clients and swallows write failures', async () => {
  const queries = [];
  const client = {
    async query(text, values) {
      queries.push({ text, values });
      return { rows: [] };
    },
  };
  await capturePointsRiskEvent(client, { headers: {} }, {
    username: 'frmm',
    accountId: 'turnkey-account',
    eventType: 'trade:sell',
    marketId: 42,
    tradeSide: 'sell',
    outcomeIndex: 0,
    amount: 55,
    shares: 99,
  });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /INSERT INTO points_risk_events/);
  assert.equal(queries[0].values[0], 'frmm');
  assert.equal(queries[0].values[2], 'trade:sell');
  assert.equal(queries[0].values[3], 42);

  await capturePointsRiskEvent({
    async query() {
      throw new Error('risk table temporarily unavailable');
    },
  }, { headers: {} }, { username: 'frmm', eventType: 'trade:buy' });
});
