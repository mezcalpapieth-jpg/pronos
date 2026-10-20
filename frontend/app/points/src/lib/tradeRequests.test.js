import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradeRequestClient } from './tradeRequests.js';

const ownerA = `421614:0x${'a'.repeat(40)}`, ownerB = `421614:0x${'b'.repeat(40)}`;
function fixture() {
  const data = new Map(), posts = [], server = new Map();
  let sequence = 0;
  const f = { scope: ownerA, loseReply: false, pending: false, storageFails: false, remote: null };
  const storage = () => ({
    getItem: key => data.get(key) || null,
    setItem: (key, value) => { if (f.storageFails) throw Error('storage disabled'); data.set(key, value); },
    removeItem: key => data.delete(key),
  });
  const get = async url => {
    if (url.endsWith('action=identity')) return { scope: f.scope };
    if (url.endsWith('action=pending')) return { request: f.remote };
    const requestId = new URL(url, 'https://unused').searchParams.get('requestId');
    const row = server.get(`${f.scope}:${requestId}`);
    if (!row) throw Object.assign(Error('trade_request_not_found'), { status: 404 });
    return row;
  };
  const post = async (url, body) => {
    posts.push({ url, body });
    if (f.onPost) await f.onPost();
    const state = f.pending ? { status: 'pending', pending: true, ok: false, error: 'trade_request_pending' }
      : { status: 'confirmed', requestId: body.requestId, result: { ok: true, sharesOut: 20 }, indexingStatus: 'pending' };
    server.set(`${f.scope}:${body.requestId}`, state);
    if (f.loseReply) throw TypeError('network response lost');
    return f.pending ? state : { ...state.result, requestId: body.requestId };
  };
  const client = () => createTradeRequestClient({ get, post, storage, uuid: () => `request-000${++sequence}` });
  return Object.assign(f, { data, server, posts, client });
}
const body = { marketId: 3, outcomeIndex: 0, collateral: 10, minSharesOut: 18 };
const options = { sourceMarketId: 360636 };

test('lost success response survives refresh and is acknowledged without a new trade', async () => {
  const f = fixture(); f.loseReply = true;
  await assert.rejects(f.client().trade('buy', body, options), /network/);
  assert.equal(f.data.size, 1); f.loseReply = false;
  const refreshed = f.client();
  assert.equal((await refreshed.pending()).status, 'confirmed');
  const result = await refreshed.trade('buy', { ...body, minSharesOut: 19 }, options);
  assert.equal(result.sharesOut, 20); assert.equal(f.posts.length, 1); assert.equal(f.data.size, 0);
});
test('pending retry uses the original key, amount and price protection', async () => {
  const f = fixture(); f.pending = true;
  await assert.rejects(f.client().trade('buy', body, options), { code: 'trade_request_pending' });
  await assert.rejects(f.client().trade('buy', { ...body, minSharesOut: 19 }, options), { code: 'trade_request_pending' });
  assert.deepEqual(f.posts[1].body, f.posts[0].body);
  assert.equal(f.posts[1].body.minSharesOut, 18);
  f.pending = false; assert.equal((await f.client().resume()).ok, true);
  assert.equal(f.posts[2].body.requestId, f.posts[0].body.requestId);
});
test('a different action or amount cannot hide an unresolved trade', async () => {
  const f = fixture(); f.pending = true; const client = f.client();
  await assert.rejects(client.trade('buy', body, options));
  await assert.rejects(client.trade('buy', { ...body, collateral: 11 }, options), { code: 'trade_request_pending' });
  await assert.rejects(client.trade('sell', { marketId: 3, shares: 10 }, options), { code: 'trade_request_pending' });
  assert.equal(f.posts.length, 1);
});
test('account changes isolate pending requests using the server-authenticated wallet', async () => {
  const f = fixture(); f.pending = true; const client = f.client();
  await assert.rejects(client.trade('buy', body, options));
  const firstKey = f.posts[0].body.requestId;
  f.scope = ownerB; assert.equal(await client.pending(), null);
  f.pending = false; await client.trade('buy', body, options);
  assert.notEqual(f.posts[1].body.requestId, firstKey);
  f.scope = ownerA; assert.equal((await client.pending()).requestId, firstKey);
});
test('storage failure prevents POST; no unsafe fallback loses the request key', async () => {
  const f = fixture(); f.storageFails = true;
  await assert.rejects(f.client().trade('buy', body, options), { code: 'trade_recovery_unavailable' });
  assert.equal(f.posts.length, 0);
});
test('a new browser can discover and resume an owner-scoped server request', async () => {
  const f = fixture(); f.remote = { action: 'buy', body: { ...body, requestId: 'remote-request' }, sourceMarketId: null };
  const client = f.client(); assert.equal((await client.pending()).requestId, 'remote-request');
  const result = await client.resume(); assert.equal(result.ok, true);
  assert.equal(f.posts[0].body.requestId, 'remote-request');
});
test('concurrent identical clicks share one submission; a different action gets pending', async () => {
  const f = fixture(); let entered, release;
  const called = new Promise(resolve => { entered = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  f.onPost = async () => { entered(); await paused; };
  const client = f.client(), first = client.trade('buy', body, options); await called;
  const duplicate = client.trade('buy', body, options);
  await assert.rejects(client.trade('sell', { marketId: 3, shares: 10 }, options), { code: 'trade_request_pending' });
  release(); assert.deepEqual(await duplicate, await first); assert.equal(f.posts.length, 1);
});
test('reverted and rejected requests are acknowledged without resubmitting', async () => {
  for (const status of ['reverted','rejected']) {
    const f = fixture(); f.pending = true; const client = f.client();
    await assert.rejects(client.trade('buy', body, options));
    const requestId = f.posts[0].body.requestId;
    f.server.set(`${ownerA}:${requestId}`, { requestId, status, error: status === 'rejected' ? 'market_closed' : 'tx_reverted' });
    await assert.rejects(client.resume(), { code: status === 'rejected' ? 'market_closed' : 'tx_reverted' });
    assert.equal(f.posts.length, 1); assert.equal(f.data.size, 0);
  }
});
