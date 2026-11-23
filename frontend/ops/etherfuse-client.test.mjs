import test from 'node:test';
import assert from 'node:assert/strict';
import { createEtherfuseSandboxClient, EtherfuseSandboxError,
  ETHERFUSE_SANDBOX_ORIGIN } from './etherfuse-client.mjs';

const apiKey = 'api_sand_fake_test_key';
const orgId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const accountId = '8c1d2e3f-4a5b-4c6d-8e7f-901a2b3c4d5e';
const quoteId = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
});

test('pins sandbox routes, raw auth, request policy and exact decimal strings', async () => {
  const calls = [];
  const quoteBody = { source: { type: 'stored', id: accountId },
    destination: { type: 'stored', id: accountId }, sourceAmount: '100.000000',
    sourceAsset: 'MXN', destinationAsset: '0x0000000000000000000000000000000000000001' };
  const accountBody = { kind: 'bank', country: 'MX', currency: 'MXN',
    accountDetails: { kind: 'clabe', clabe: '012180000000000002' } };
  const replies = [json({ id: orgId }), json({ markets: [], tokens: [] }),
    json({ id: accountId, rails: {} }, 201), json({ id: accountId }),
    json({ quoteId, destinationAmount: '5.123456789012345678', sourceAmount: '100.000000' }),
    json({ id: quoteId, status: 'created' }, 201), json({ id: quoteId, status: 'funded' }),
    new Response(null, { status: 200 })];
  const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: async (url, init) => {
    calls.push({ url, init }); return replies.shift();
  } });
  assert.deepEqual(await client.org(), { id: orgId });
  assert.deepEqual(await client.assets(), { markets: [], tokens: [] });
  await client.registerAccount(orgId, accountBody);
  await client.account(orgId, accountId);
  const quoted = await client.quote(orgId, quoteBody);
  assert.equal(quoted.destinationAmount, '5.123456789012345678');
  await client.createOrder(orgId, quoteId);
  await client.order(orgId, quoteId);
  assert.equal(await client.simulateDeposit(orgId, quoteId, '100.000000'), null);
  assert.deepEqual(calls.map(call => call.url), [
    '/me', '/supported_assets', `/organization/${orgId}/payment_account`,
    `/organization/${orgId}/payment_account/${accountId}`, `/organization/${orgId}/quote`,
    `/organization/${orgId}/order`, `/organization/${orgId}/order/${quoteId}`,
    `/organization/${orgId}/order/${quoteId}/fiat_received`,
  ].map(path => ETHERFUSE_SANDBOX_ORIGIN + path));
  assert.deepEqual(calls.map(call => call.init.method), ['GET', 'GET', 'POST', 'GET', 'POST', 'POST', 'GET', 'POST']);
  for (const { init } of calls) {
    assert.equal(init.headers.Authorization, apiKey);
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.equal(calls[2].init.body, JSON.stringify(accountBody));
  assert.equal(calls[4].init.body, JSON.stringify(quoteBody));
  assert.deepEqual(JSON.parse(calls[5].init.body), { quoteId });
  assert.deepEqual(JSON.parse(calls[7].init.body), { amount: '100.000000' });
  assert.equal(Object.isFrozen(client), true);
});

test('sends the provider-issued colon-delimited key unchanged to sandbox only', async () => {
  for (const prefix of ['Api_sand', 'API_SAND']) {
    const issuedKey = `${prefix}:test_key_id:dummy-secret:example+/=`;
    const client = createEtherfuseSandboxClient({ apiKey: issuedKey, fetchImpl: async (url, init) => {
      assert.equal(url, ETHERFUSE_SANDBOX_ORIGIN + '/me');
      assert.equal(init.headers.Authorization, issuedKey);
      return json({ id: orgId });
    } });
    assert.deepEqual(await client.org(), { id: orgId });
  }
});

test('rejects production keys, injectable paths and numeric or nonpositive amounts before HTTP', async () => {
  for (const bad of ['api_prod_fake', 'Api_prod:test_key_id:dummy-secret', 'Bearer api_sand_fake',
    'Bearer Api_sand:test_key_id:dummy-secret', 'api_sand_', 'api_sand_x\nsecret',
    'Api_sand::dummy-secret', 'Api_sand:test_key_id:', 'Api_sand:test_key_id:dummy-secret\r\n', undefined]) {
    assert.throws(() => createEtherfuseSandboxClient({ apiKey: bad }), { code: 'sandbox_api_key_required' });
  }
  let calls = 0;
  const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: () => { calls++; } });
  assert.throws(() => client.account('https://evil.example', accountId), { code: 'invalid_id' });
  assert.throws(() => client.order(orgId, '../order'), { code: 'invalid_id' });
  assert.throws(() => client.registerAccount(orgId, []), { code: 'invalid_body' });
  for (const value of [100, 0, '0', '0.000000', '-1', '1e2', ' 100', 'NaN', '1.2.3']) {
    assert.throws(() => client.quote(orgId, { sourceAmount: value }), { code: 'invalid_decimal_amount' });
    assert.throws(() => client.simulateDeposit(orgId, quoteId, value), { code: 'invalid_decimal_amount' });
  }
  assert.equal(calls, 0);
});

test('limits asset discovery to the registered Monad wallet in its owning organization', async () => {
  const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: async url => {
    const request = new URL(url);
    assert.equal(request.pathname, '/supported_assets');
    assert.deepEqual(Object.fromEntries(request.searchParams), {
      chain: 'monad', organizationId: orgId, paymentAccountId: accountId,
    });
    return json({ markets: [], tokens: [] });
  } });
  await client.assets(orgId, accountId);
});

test('reads RFC 9457 type slug and safe remediation fields, excluding provider body details', async () => {
  const secret = 'do-not-log-bank-account-or-key';
  const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: async () => json({
    type: 'https://docs.etherfuse.com/ramp/v2/errors/registration-info-required',
    title: secret, detail: secret, code: 'wrong-code', status: 400,
    instance: 'tag:etherfuse.com,2026-08-28:R2-10120/0b1c2d3e',
    missing: ['#/registrationInfo/taxId', secret], required: ['#/registrationInfo/taxId'],
    errors: [{ pointer: '#/accountDetails/clabe', detail: secret }],
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  }, 422) });
  await assert.rejects(client.org(), error => {
    assert.ok(error instanceof EtherfuseSandboxError);
    assert.equal(error.code, 'registration-info-required');
    assert.equal(error.providerCode, 'registration-info-required');
    assert.equal(error.status, 422);
    assert.equal(error.httpStatus, 422);
    assert.equal(error.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.deepEqual(error.missing, ['#/registrationInfo/taxId']);
    assert.deepEqual(error.pointers, ['#/accountDetails/clabe']);
    assert.equal(JSON.stringify(error).includes(secret), false);
    assert.equal(error.stack.includes(secret), false);
    return true;
  });
});

test('does not infer a provider code from arbitrary text, title, code or foreign type URLs', async () => {
  for (const body of [
    { type: 'https://evil.example/errors/quote-expired', code: 'quote-expired', title: 'Quote expired' },
    { type: 'https://docs.etherfuse.com/ramp/v2/errors/quote-expired?secret=1' },
  ]) {
    const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: async () => json(body, 400) });
    await assert.rejects(client.org(), { code: 'http_error', providerCode: null, status: 400 });
  }
  const client = createEtherfuseSandboxClient({ apiKey,
    fetchImpl: async () => new Response('private provider detail', { status: 502 }) });
  await assert.rejects(client.org(), { code: 'http_error', status: 502 });
});

test('bounds fetch and response-body time, aborts, and never exposes network causes', async () => {
  for (const stage of ['fetch', 'body']) {
    let signal;
    const client = createEtherfuseSandboxClient({ apiKey, timeoutMs: 15,
      fetchImpl: async (_url, init) => {
        signal = init.signal;
        if (stage === 'fetch') return new Promise(() => {});
        return { ok: true, status: 200, text: () => new Promise(() => {}) };
      } });
    await assert.rejects(client.org(), { code: 'request_timeout' });
    assert.equal(signal.aborted, true);
  }
  const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: async () => {
    throw new Error('private cause including credentials');
  } });
  await assert.rejects(client.org(), error => {
    assert.equal(error.code, 'network_error');
    assert.equal(error.cause, undefined);
    assert.equal(error.stack.includes('private cause'), false);
    return true;
  });
});

test('rejects malformed, oversized, redirected and unexpectedly empty success responses', async () => {
  for (const [response, code] of [
    [new Response('{'), 'invalid_json'],
    [new Response(null, { status: 200 }), 'empty_response'],
    [new Response(' '.repeat(1_048_577)), 'response_too_large'],
    [{ redirected: true }, 'unexpected_redirect'],
  ]) {
    const client = createEtherfuseSandboxClient({ apiKey, fetchImpl: async () => response });
    await assert.rejects(client.org(), { code });
  }
});
