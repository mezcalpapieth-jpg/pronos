import test from 'node:test';
import assert from 'node:assert/strict';

import { decryptOAuthToken, encryptOAuthToken } from './oauth-token-crypto.js';

test('OAuth token encryption round-trips without storing plaintext', () => {
  const env = { OAUTH_COOKIE_SECRET: 'test-secret-for-oauth-token-cipher' };
  const encrypted = encryptOAuthToken('x-access-token', env);
  assert.match(encrypted, /^v1:/);
  assert.equal(encrypted.includes('x-access-token'), false);
  assert.equal(decryptOAuthToken(encrypted, env), 'x-access-token');
});

test('OAuth token encryption is disabled without a server secret', () => {
  const env = {};
  assert.equal(encryptOAuthToken('x-access-token', env), null);
  assert.equal(decryptOAuthToken('v1:not:real:value', env), null);
});
