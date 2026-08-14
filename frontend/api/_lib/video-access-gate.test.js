import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIDEO_ACCESS_COOKIE_NAME,
  buildVideoAccessCookie,
  configuredVideoAccessPassword,
  readVideoAccessCookie,
  verifyVideoAccessCookie,
  verifyVideoAccessPassword,
} from './video-access-gate.js';

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

test('video gate falls back to the baked-in password so a missing env var never kills a shoot', () => {
  withEnv({ VIDEO_ACCESS_PASSWORD: null, VERCEL_ENV: 'production' }, () => {
    assert.equal(configuredVideoAccessPassword(), 'FABIAN');
    assert.equal(verifyVideoAccessPassword('FABIAN').ok, true);
  });
});

test('video gate password is case-insensitive and trims whitespace', () => {
  withEnv({ VIDEO_ACCESS_PASSWORD: null }, () => {
    assert.equal(verifyVideoAccessPassword('fabian').ok, true);
    assert.equal(verifyVideoAccessPassword('  Fabian  ').ok, true);
    assert.equal(verifyVideoAccessPassword('fabiana').ok, false);
    assert.equal(verifyVideoAccessPassword('').ok, false);
    assert.equal(verifyVideoAccessPassword(null).ok, false);
  });
});

test('an env password overrides the default', () => {
  withEnv({ VIDEO_ACCESS_PASSWORD: 'otra-clave' }, () => {
    assert.equal(verifyVideoAccessPassword('otra-clave').ok, true);
    assert.equal(verifyVideoAccessPassword('FABIAN').ok, false);
  });
});

test('a freshly built cookie round-trips through the reader and verifier', () => {
  withEnv({ VIDEO_ACCESS_PASSWORD: null, VIDEO_ACCESS_SECRET: 'test-secret' }, () => {
    const header = buildVideoAccessCookie({ headers: {} });
    const value = readVideoAccessCookie({ cookie: header.split(';')[0] });
    assert.equal(verifyVideoAccessCookie(value), true);
  });
});

test('expired and tampered cookies are rejected', () => {
  withEnv({ VIDEO_ACCESS_PASSWORD: null, VIDEO_ACCESS_SECRET: 'test-secret' }, () => {
    const header = buildVideoAccessCookie({ headers: {} });
    const value = readVideoAccessCookie({ cookie: header.split(';')[0] });

    // Same cookie, evaluated 31 days later — past the 30-day TTL.
    const later = Date.now() + 31 * 24 * 60 * 60 * 1000;
    assert.equal(verifyVideoAccessCookie(value, { now: later }), false);

    const [exp] = value.split('.');
    assert.equal(verifyVideoAccessCookie(`${exp}.forged-signature`), false);
    assert.equal(verifyVideoAccessCookie(''), false);
    assert.equal(verifyVideoAccessCookie(null), false);
  });
});

test('the video cookie is namespaced away from the MVP gate cookie', () => {
  assert.equal(VIDEO_ACCESS_COOKIE_NAME, 'pronos_video_access');
  withEnv({ VIDEO_ACCESS_SECRET: 'test-secret' }, () => {
    // An MVP cookie sitting in the same jar must not unlock the video page.
    assert.equal(readVideoAccessCookie({ cookie: 'pronos_mvp_access=123.abc' }), null);
  });
});
