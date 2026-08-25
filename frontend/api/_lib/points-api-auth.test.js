import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalRequestBody,
  createApiCredentials,
  hashApiCredential,
  normalizeApiPermissions,
  readRawRequestBody,
  signApiRequest,
  stableApiRequestHash,
} from './points-api-auth.js';

test('public api credentials store verifiers without raw secrets', () => {
  const credentials = createApiCredentials();
  assert.match(credentials.apiKey, /^pk_pronos_/);
  assert.match(credentials.apiSecret, /^pnsec_/);
  assert.match(credentials.keyHash, /^sha256:/);
  assert.match(credentials.secretHash, /^sha256:/);
  assert.notEqual(credentials.keyHash, credentials.apiKey);
  assert.notEqual(credentials.secretHash, credentials.apiSecret);
  assert.notEqual(credentials.secretCiphertext.includes(credentials.apiSecret), true);
  assert.equal(hashApiCredential(credentials.apiKey), credentials.keyHash);
});

test('public api request signatures use the documented canonical payload', () => {
  const signature = signApiRequest({
    timestamp: '1787650000000',
    method: 'post',
    path: '/api/v1/trades',
    body: '{"marketId":123,"side":"BUY"}',
    secret: 'test-secret',
  });
  assert.equal(
    signature,
    signApiRequest({
      timestamp: '1787650000000',
      method: 'POST',
      path: '/api/v1/trades',
      body: '{"marketId":123,"side":"BUY"}',
      secret: 'test-secret',
    }),
  );
  assert.notEqual(
    signature,
    signApiRequest({
      timestamp: '1787650000000',
      method: 'GET',
      path: '/api/v1/trades',
      body: '{"marketId":123,"side":"BUY"}',
      secret: 'test-secret',
    }),
  );
});

test('public api normalizes permissions and stable request hashes', () => {
  assert.deepEqual(normalizeApiPermissions(['trade']), ['READ', 'TRADE']);
  assert.deepEqual(normalizeApiPermissions('["READ","admin"]'), ['READ']);

  const req = {
    method: 'POST',
    url: '/api/v1/trades?dryRun=0',
    body: { marketId: 123, side: 'BUY' },
  };
  assert.equal(canonicalRequestBody(req), '{"marketId":123,"side":"BUY"}');
  assert.equal(stableApiRequestHash(req).length, 64);
  assert.notEqual(stableApiRequestHash(req), stableApiRequestHash({ ...req, method: 'GET' }));
});

test('public api preserves raw json for signed write requests', async () => {
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: '{ "marketId": 123, "side": "BUY" }',
  };
  const raw = await readRawRequestBody(req);
  assert.equal(raw, '{ "marketId": 123, "side": "BUY" }');
  assert.deepEqual(req.body, { marketId: 123, side: 'BUY' });
  assert.equal(canonicalRequestBody(req), raw);

  const parsedReq = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { side: 'SELL', marketId: 123 },
  };
  assert.equal(await readRawRequestBody(parsedReq), '{"side":"SELL","marketId":123}');
  assert.equal(canonicalRequestBody(parsedReq), '{"side":"SELL","marketId":123}');
});
