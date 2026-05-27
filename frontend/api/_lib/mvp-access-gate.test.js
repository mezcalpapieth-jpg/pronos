import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMvpAccessCookie,
  configuredMvpAccessPassword,
  verifyMvpAccessCookie,
  verifyMvpAccessPassword,
} from './mvp-access-gate.js';

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

test('local access gate uses the dev fallback password when no env password exists', () => {
  withEnv({
    VERCEL_ENV: null,
    MVP_ACCESS_PASSWORD: null,
  }, () => {
    assert.equal(configuredMvpAccessPassword(), 'mezcal');
    assert.equal(verifyMvpAccessPassword('mezcal').ok, true);
    assert.equal(verifyMvpAccessPassword('wrong').ok, false);
  });
});

test('production access gate requires an explicit password', () => {
  withEnv({
    VERCEL_ENV: 'production',
    MVP_ACCESS_PASSWORD: null,
  }, () => {
    assert.equal(configuredMvpAccessPassword(), null);
    const result = verifyMvpAccessPassword('mezcal');
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
  });
});

test('access cookies are signed and expire', () => {
  withEnv({
    VERCEL_ENV: null,
    MVP_ACCESS_PASSWORD: 'local-pass',
    MVP_ACCESS_SECRET: 'local-secret',
  }, () => {
    const now = 1_800_000_000_000;
    const header = buildMvpAccessCookie({ now });
    const value = header.match(/^pronos_mvp_access=([^;]+)/)?.[1];

    assert.ok(value);
    assert.equal(verifyMvpAccessCookie(value, { now: now + 1000 }), true);
    assert.equal(verifyMvpAccessCookie(value, { now: now + 8 * 24 * 60 * 60 * 1000 }), false);
  });
});
