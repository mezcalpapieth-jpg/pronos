import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TOKEN_URL,
  USER_URL,
  buildXTokenRequestAttempts,
  exchangeXAuthorizationCode,
} from './x-oauth.js';

test('X OAuth uses current X API hosts', () => {
  assert.equal(TOKEN_URL, 'https://api.x.com/2/oauth2/token');
  assert.equal(USER_URL, 'https://api.x.com/2/users/me');
});

test('X OAuth confidential token request follows current docs', () => {
  const [confidential, fallback] = buildXTokenRequestAttempts({
    code: 'code-123',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://pronos.io/api/social/x/callback',
    verifier: 'verifier-123',
  });

  assert.equal(confidential.mode, 'confidential');
  assert.equal(confidential.url, TOKEN_URL);
  assert.equal(confidential.init.headers.Authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
  assert.equal(confidential.body.get('code'), 'code-123');
  assert.equal(confidential.body.get('grant_type'), 'authorization_code');
  assert.equal(confidential.body.get('redirect_uri'), 'https://pronos.io/api/social/x/callback');
  assert.equal(confidential.body.get('code_verifier'), 'verifier-123');
  assert.equal(confidential.body.has('client_id'), false);

  assert.equal(fallback.mode, 'public');
  assert.equal(fallback.init.headers.Authorization, undefined);
  assert.equal(fallback.body.get('client_id'), 'client-id');
});

test('X OAuth public token request works without a client secret', () => {
  const attempts = buildXTokenRequestAttempts({
    code: 'code-123',
    clientId: 'client-id',
    clientSecret: '',
    redirectUri: 'https://pronos.io/api/social/x/callback',
    verifier: 'verifier-123',
  });

  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].mode, 'public');
  assert.equal(attempts[0].body.get('client_id'), 'client-id');
  assert.equal(attempts[0].init.headers.Authorization, undefined);
});

test('X OAuth retries public mode when confidential auth is rejected', async () => {
  const calls = [];
  const result = await exchangeXAuthorizationCode({
    code: 'code-123',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://pronos.io/api/social/x/callback',
    verifier: 'verifier-123',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return {
          ok: false,
          status: 401,
          text: async () => '{"error":"unauthorized_client","error_description":"Missing valid authorization header"}',
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'token-abc' }),
      };
    },
  });

  assert.equal(result.accessToken, 'token-abc');
  assert.equal(result.mode, 'public');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization.startsWith('Basic '), true);
  assert.equal(calls[1].init.headers.Authorization, undefined);
});
