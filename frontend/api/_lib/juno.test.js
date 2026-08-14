import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  buildJunoAuthorizationHeader,
  buildJunoHeaders,
  isJunoConfigured,
  normalizeJunoBaseUrl,
} from './juno.js';

test('buildJunoAuthorizationHeader signs nonce, method, path, and exact JSON payload', () => {
  const nonce = 1700000000000;
  const method = 'POST';
  const path = '/mint_platform/v1/withdrawals';
  const payload = JSON.stringify({
    blockchain: 'ARBITRUM',
    asset: 'MXNB',
    amount: '100',
    address: '0x871697383394d6fbB253A2D6c799C398dAe08365',
    compliance: {},
  });
  const expected = createHmac('sha256', 'secret-123')
    .update(`${nonce}${method}${path}${payload}`)
    .digest('hex');

  assert.equal(
    buildJunoAuthorizationHeader({
      apiKey: 'key-123',
      apiSecret: 'secret-123',
      nonce,
      method,
      path,
      payload,
    }),
    `Bitso key-123:${nonce}:${expected}`,
  );
});

test('buildJunoHeaders includes bearer token and idempotency key when provided', () => {
  const headers = buildJunoHeaders({
    apiKey: 'key',
    apiSecret: 'secret',
    bearerToken: 'bearer-token',
    nonce: 1700000000001,
    method: 'GET',
    path: '/mint_platform/v1/clabes',
    idempotencyKey: 'idem-1',
  });

  assert.match(headers.Authorization, /^Bitso key:1700000000001:/);
  assert.equal(headers.BitsoAuth, 'Bearer bearer-token');
  assert.equal(headers['X-Idempotency-Key'], 'idem-1');
  assert.equal(headers['Content-Type'], 'application/json');
});

test('isJunoConfigured requires API key, secret, bearer token, and base URL', () => {
  assert.equal(isJunoConfigured({}), false);
  assert.equal(isJunoConfigured({
    JUNO_API_KEY: 'key',
    JUNO_API_SECRET: 'secret',
    JUNO_BEARER_TOKEN: 'bearer',
    JUNO_API_BASE_URL: 'https://stage.buildwithjuno.com',
  }), true);
});

test('normalizeJunoBaseUrl removes trailing slash and defaults to stage', () => {
  assert.equal(normalizeJunoBaseUrl('https://buildwithjuno.com/'), 'https://buildwithjuno.com');
  assert.equal(normalizeJunoBaseUrl(''), 'https://stage.buildwithjuno.com');
});
