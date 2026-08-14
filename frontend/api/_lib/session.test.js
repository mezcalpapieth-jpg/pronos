import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionToken,
  verifySessionToken,
} from './session.js';

function withEnv(patch, fn) {
  const keys = Object.keys(patch);
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('production sessions require the dedicated points session secret', () => {
  assert.throws(() => withEnv({
    VERCEL_ENV: 'production',
    POINTS_SESSION_SECRET: null,
    MVP_ACCESS_SECRET: 'mvp-secret-that-used-to-fallback',
    CLOB_SESSION_SECRET: 'clob-secret-that-used-to-fallback',
  }, () => createSessionToken({
    suborgId: 'sub_123',
    email: 'user@example.com',
    username: 'frmm',
  })), /POINTS_SESSION_SECRET not configured/);
});

test('local sessions can still use legacy fallback secrets', () => {
  const token = withEnv({
    VERCEL_ENV: null,
    POINTS_SESSION_SECRET: null,
    MVP_ACCESS_SECRET: 'local-secret-for-dev-session',
    CLOB_SESSION_SECRET: null,
  }, () => createSessionToken({
    suborgId: 'sub_123',
    email: 'User@Example.com',
    username: 'frmm',
  }));

  const claims = withEnv({
    VERCEL_ENV: null,
    POINTS_SESSION_SECRET: null,
    MVP_ACCESS_SECRET: 'local-secret-for-dev-session',
    CLOB_SESSION_SECRET: null,
  }, () => verifySessionToken(token));

  assert.equal(claims.sub, 'sub_123');
  assert.equal(claims.email, 'user@example.com');
});
