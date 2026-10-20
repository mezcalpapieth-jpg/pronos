import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtocolPost } from './protocolTradeRequests.js';

function fixture(enabled) {
  const calls = [], data = new Map(), states = new Map(), scope = `421614:0x${'a'.repeat(40)}`;
  const f = { pending: false, loseReply: false, enabled, calls };
  f.fetch = async (url, options) => {
    calls.push({ url, options });
    let status = 200, body;
    if (url.endsWith('action=config')) body = { durableTrades: f.enabled };
    else if (url.endsWith('action=identity')) body = { scope };
    else if (url.endsWith('action=pending')) body = { request: null };
    else if (url.includes('?requestId=')) {
      body = states.get(new URL(url, 'https://unused').searchParams.get('requestId'));
      if (!body) { status = 404; body = { error: 'trade_request_not_found' }; }
    } else if (options.method === 'POST') {
      const request = JSON.parse(options.body);
      if (f.enabled && /\/(buy|sell|redeem)$/.test(url)) {
        assert.equal(request.requestScope, scope);
        assert.equal(request.requestId, 'request-0001');
        status = f.pending ? 202 : 200;
        body = f.pending ? { pending: true, ok: false, status: 'pending' } : { ok: true, sharesOut: 20 };
        states.set(request.requestId, f.pending ? body : { status: 'confirmed', result: body });
        if (f.loseReply) throw TypeError('response lost');
      } else body = { ok: true };
    } else throw Error(url);
    return { ok: status < 400, status, json: async () => body };
  };
  f.client = () => createProtocolPost({ fetch: f.fetch, uuid: () => 'request-0001', storage: () => ({
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key),
  }) });
  return f;
}
test('MVP quotes bypass the request ledger and disabled runtimes preserve their POST body', async () => {
  const f = fixture(false), post = f.client(), body = { marketId: 3, collateral: 10 };
  assert.equal((await post('/api/protocol/quote-buy', body)).ok, true);
  assert.equal(f.calls.length, 1);
  assert.equal((await post('/api/protocol/buy', body)).ok, true);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), body);
});
test('MVP buy/sell/redeem callers use durable keys and never treat HTTP 202 as success', async () => {
  for (const action of ['buy','sell','redeem']) {
    const f = fixture(true); f.pending = true;
    const result = await f.client()(`/api/protocol/${action}`, { marketId: 3, collateral: 10 });
    assert.equal(result.ok, false); assert.equal(result.status, 202); assert.equal(result.data.error, 'trade_request_pending');
  }
});
test('MVP refresh recovers a lost success response through the shared request journal', async () => {
  const f = fixture(true); f.loseReply = true;
  assert.equal((await f.client()('/api/protocol/buy', { marketId: 3, collateral: 10 })).ok, false);
  f.loseReply = false;
  assert.equal((await f.client()('/api/protocol/buy', { marketId: 3, collateral: 10 })).data.sharesOut, 20);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
});
