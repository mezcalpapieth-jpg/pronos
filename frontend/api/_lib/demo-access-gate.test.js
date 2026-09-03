import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_ACCESS_COOKIE_NAME,
  buildDemoAccessCookie,
  configuredDemoAccessPassword,
  readDemoAccessCookie,
  verifyDemoAccessCookie,
  verifyDemoAccessPassword,
} from './demo-access-gate.js';

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

test('demo gate falls back to the baked-in password so a missing env var never kills a live presentation', () => {
  withEnv({ POINTS_DEMO_PASSWORD: null, VERCEL_ENV: 'production' }, () => {
    assert.equal(configuredDemoAccessPassword(), 'RIS2026');
    assert.equal(verifyDemoAccessPassword('RIS2026').ok, true);
  });
});

test('demo gate password is case-insensitive and trims whitespace', () => {
  withEnv({ POINTS_DEMO_PASSWORD: null }, () => {
    assert.equal(verifyDemoAccessPassword('ris2026').ok, true);
    assert.equal(verifyDemoAccessPassword('  Ris2026  ').ok, true);
    assert.equal(verifyDemoAccessPassword('ris20266').ok, false);
    assert.equal(verifyDemoAccessPassword('').ok, false);
    assert.equal(verifyDemoAccessPassword(null).ok, false);
  });
});

test('an env password overrides the default', () => {
  withEnv({ POINTS_DEMO_PASSWORD: 'otra-clave' }, () => {
    assert.equal(verifyDemoAccessPassword('otra-clave').ok, true);
    assert.equal(verifyDemoAccessPassword('RIS2026').ok, false);
  });
});

test('a freshly built cookie round-trips through the reader and verifier', () => {
  withEnv({ POINTS_DEMO_PASSWORD: null, POINTS_DEMO_SECRET: 'test-secret' }, () => {
    const header = buildDemoAccessCookie({ headers: {} });
    const value = readDemoAccessCookie({ cookie: header.split(';')[0] });
    assert.equal(verifyDemoAccessCookie(value), true);
  });
});

test('expired and tampered cookies are rejected', () => {
  withEnv({ POINTS_DEMO_PASSWORD: null, POINTS_DEMO_SECRET: 'test-secret' }, () => {
    const header = buildDemoAccessCookie({ headers: {} });
    const value = readDemoAccessCookie({ cookie: header.split(';')[0] });

    // Same cookie, evaluated 31 days later — past the 30-day TTL.
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
    assert.equal(verifyDemoAccessCookie(value, { now: later }), false);

    const [exp] = value.split('.');
    assert.equal(verifyDemoAccessCookie(`${exp}.forged-signature`), false);
    assert.equal(verifyDemoAccessCookie(''), false);
    assert.equal(verifyDemoAccessCookie(null), false);
  });
});

test('the demo cookie is namespaced away from the video and MVP gate cookies', () => {
  assert.equal(DEMO_ACCESS_COOKIE_NAME, 'pronos_demo_access');
  withEnv({ POINTS_DEMO_SECRET: 'test-secret' }, () => {
    // Neither sibling gate's cookie may unlock the presentation demo.
    assert.equal(readDemoAccessCookie({ cookie: 'pronos_video_access=123.abc' }), null);
    assert.equal(readDemoAccessCookie({ cookie: 'pronos_mvp_access=123.abc' }), null);
  });
});
