import assert from 'node:assert/strict';
import test from 'node:test';
import { createPolymarketPilotHandler, POLYMARKET_PILOT_POLICY } from './polymarket-pilot.js';

const market = { id: '6428654', outcomes: [{ label: 'Heat', tokenId: '123' }, { label: 'Jazz', tokenId: '456' }] };

function harness(options = {}) {
  const calls = [];
  const handler = createPolymarketPilotHandler({
    env: { POLYMARKET_PILOT_ENABLED: 'true' },
    now: () => 1000,
    discover: async input => { calls.push(['markets', input]); return [market]; },
    loadSnapshot: async input => { calls.push(['snapshot', input]); return { market }; },
    quote: input => { calls.push(['quote', input]); return { totalSpend: '10.000000' }; },
    ...options,
  });
  async function request(query = {}, method = 'GET', extra = {}) {
    const result = { headers: {}, status: null, body: null };
    const res = {
      setHeader: (key, value) => { result.headers[key] = value; },
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
      end() { return this; },
    };
    await handler({ method, headers: {}, query, ...extra }, res);
    return result;
  }
  return { calls, request };
}

test('pilot is off by default and cannot make remote calls while disabled', async () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1']) {
    const h = harness({ env: { POLYMARKET_PILOT_ENABLED: value } });
    assert.equal((await h.request()).status, 404);
    assert.deepEqual(h.calls, []);
  }
});

test('enabled discovery returns bounded public data and immutable no-subsidy policy', async () => {
  const h = harness();
  const result = await h.request();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.markets, [market]);
  assert.equal(h.calls[0][1].limit, 5);
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.body.policy.tradingEnabled, false);
  assert.equal(result.body.policy.subsidizesVenueFees, false);
  assert.equal(result.body.policy.subsidizesFunding, false);
  assert.equal(result.body.policy.pronosRebateBps, 0);
  assert.equal(result.body.policy.builderFeeBps, 50);
  assert.equal(result.body.policy.makerFeeBps, 0);
  assert.equal(result.body.policy.builderFeeStatus, 'target_unverified');
  assert.equal(result.body.policy.feeCollectionVerified, false);
  assert.match(result.body.policy.builderCode, /^0x[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(POLYMARKET_PILOT_POLICY), true);
});

test('state-changing methods and order actions never reach the venue connector', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    const h = harness();
    const result = await h.request({ action: 'quote' }, method);
    assert.equal(result.status, 405);
    assert.deepEqual(h.calls, []);
  }
  const h = harness();
  assert.equal((await h.request({ action: 'order' })).status, 400);
  assert.deepEqual(h.calls, []);
});

test('buy and sell route a validated amount and outcome to fresh snapshot then calculator', async () => {
  for (const side of ['buy', 'sell']) {
    const h = harness();
    const result = await h.request({ action: 'quote', marketId: market.id, outcomeIndex: '1', side, amount: '10.25' });
    assert.equal(result.status, 200);
    assert.equal(h.calls[0][0], 'snapshot');
    assert.equal(h.calls[0][1].outcomeIndex, 1);
    assert.equal(h.calls[1][0], 'quote');
    assert.equal(h.calls[1][1].amount, '10.25');
    assert.equal(h.calls[1][1].side, side);
    assert.equal(h.calls[1][1].snapshot.market.id, market.id);
  }
});

test('malformed or unbounded input fails before any remote request', async () => {
  const valid = { action: 'quote', marketId: market.id, outcomeIndex: '0', side: 'buy', amount: '100' };
  const invalid = [
    { ...valid, marketId: 'https://example.com' },
    { ...valid, marketId: ['6428654', '1'] },
    { ...valid, outcomeIndex: '2' },
    { ...valid, side: 'BUY' },
    { ...valid, amount: '-1' },
    { ...valid, amount: '0' },
    { ...valid, amount: '1e3' },
    { ...valid, amount: '1000000.000001' },
    { ...valid, amount: '0.0000001' },
    { ...valid, builderFeeBps: '0' },
    { action: 'markets', limit: '6' },
    { action: 'markets', amount: '10' },
  ];
  for (const query of invalid) {
    const h = harness();
    assert.equal((await h.request(query)).status, 400, JSON.stringify(query));
    assert.deepEqual(h.calls, []);
  }
  const h = harness();
  assert.equal((await h.request(undefined, 'GET', { query: undefined, url: '/api/polymarket-pilot?action=markets&action=quote' })).status, 400);
});

test('upstream uppercase connector errors normalize without exposing exception details', async () => {
  const h = harness({ discover: async () => { throw Object.assign(new Error('private internal detail'), { code: 'STALE_BOOK' }); } });
  const result = await h.request();
  assert.equal(result.status, 502);
  assert.deepEqual(result.body, { ok: false, error: 'stale_book' });
  assert.equal(JSON.stringify(result).includes('private internal detail'), false);
});

test('a direct quote for an incompatible cancellation policy is rejected before calculation', async () => {
  const h = harness({
    loadSnapshot: async () => { throw Object.assign(new Error('rule mismatch'), { code: 'UNSUPPORTED_CANCELLATION' }); },
  });
  const result = await h.request({ action: 'quote', marketId: '123', outcomeIndex: '0', side: 'buy', amount: '100' });
  assert.equal(result.status, 422);
  assert.deepEqual(result.body, { ok: false, error: 'unsupported_cancellation' });
  assert.deepEqual(h.calls, []);
});

test('CORS preflight does not request venue data', async () => {
  const h = harness();
  const result = await h.request({}, 'OPTIONS');
  assert.equal(result.status, 200);
  assert.deepEqual(h.calls, []);
});
