/**
 * Referral share wrapper tests.
 *
 * Run with:
 *   node --test frontend/api/share/referral.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperSource = await readFile(new URL('./referral.js', import.meta.url), 'utf8');
const ogSource = await readFile(new URL('../og/referral.js', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(
  await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
);

function hasRule(rules, source, destination) {
  return Array.isArray(rules)
    && rules.some((rule) => rule.source === source && rule.destination === destination);
}

test('referral share wrapper exposes bot-friendly social metadata', () => {
  assert.match(wrapperSource, /og:title/);
  assert.match(wrapperSource, /twitter:card/);
  assert.match(wrapperSource, /summary_large_image/);
  assert.match(wrapperSource, /\/api\/og\/referral\?username=/);
  assert.match(wrapperSource, /\/points\/r\/\$\{username\}/);
  assert.match(wrapperSource, /http-equiv="refresh"/);
});

test('referral share route validates usernames and renders a dynamic image', () => {
  assert.match(wrapperSource, /\^\[a-z\]\[a-z0-9_\]\{2,19\}\$/);
  assert.match(ogSource, /image\/svg\+xml/);
  assert.match(ogSource, /@\$\{esc\(username\)\} te invit/);
});

test('root referral route rewrites to the share wrapper before the SPA', () => {
  assert.ok(
    hasRule(vercelConfig.rewrites, '/r/:username', '/api/share/referral?username=:username'),
    'expected /r/:username to serve the share wrapper',
  );
  assert.ok(
    !hasRule(vercelConfig.redirects, '/r/:username', '/points/r/:username'),
    'expected /r/:username to stop redirecting away before crawlers read metadata',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/points/r/:username', '/points/'),
    'expected the human referral destination to stay in the points SPA',
  );
});
