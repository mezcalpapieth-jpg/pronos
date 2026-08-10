import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_X_FOLLOW_TARGET_USERNAME,
  TOKEN_URL,
  X_API_BASE,
  USER_URL,
  buildXTokenRequestAttempts,
  exchangeXAuthorizationCode,
  normalizeXUsername,
  xUserFollowsTarget,
} from './x-oauth.js';

test('X OAuth uses current X API hosts', () => {
  assert.equal(TOKEN_URL, 'https://api.x.com/2/oauth2/token');
  assert.equal(USER_URL, 'https://api.x.com/2/users/me');
  assert.equal(X_API_BASE, 'https://api.x.com/2');
});

test('X follow verification targets the Pronos account', () => {
  assert.equal(DEFAULT_X_FOLLOW_TARGET_USERNAME, 'pronos_io');
  assert.equal(normalizeXUsername('@Pronos_IO'), 'pronos_io');
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

test('X follow verification pages through target followers', async () => {
  const calls = [];
  const result = await xUserFollowsTarget({
    userId: '123',
    username: 'fran',
    targetUserId: '999',
    bearerToken: 'app-bearer',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      assert.equal(init.headers.Authorization, 'Bearer app-bearer');
      if (calls.length === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [{ id: '1', username: 'someone' }],
            meta: { next_token: 'next-page' },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          data: [{ id: '123', username: 'Fran' }],
          meta: {},
        }),
      };
    },
  });

  assert.equal(result.follows, true);
  assert.equal(result.pages, 2);
  assert.match(calls[0].url, /\/2\/users\/999\/followers/);
  assert.match(calls[1].url, /pagination_token=next-page/);
});

test('X follow verification fails closed without a bearer token', async () => {
  await assert.rejects(
    () => xUserFollowsTarget({
      userId: '123',
      targetUserId: '999',
      bearerToken: '',
      fetchImpl: async () => {
        throw new Error('unexpected fetch');
      },
    }),
    /x_not_configured/,
  );
});
