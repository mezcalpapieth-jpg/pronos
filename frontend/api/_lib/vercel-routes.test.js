/**
 * Deployment-route tests for Vercel SPA fallbacks.
 *
 * Run with:
 *   node --test frontend/api/_lib/vercel-routes.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const vercelConfig = JSON.parse(
  await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'),
);

function hasRule(rules, source, destination) {
  return Array.isArray(rules)
    && rules.some((rule) => rule.source === source && rule.destination === destination);
}

test('public user profile route has a root shortcut redirect', () => {
  assert.ok(
    hasRule(vercelConfig.redirects, '/u/:username', '/points/u/:username'),
    'expected /u/:username to redirect to /points/u/:username',
  );
});

test('public user profile route hard-refreshes through the points SPA', () => {
  assert.ok(
    hasRule(vercelConfig.rewrites, '/points/u/:username', '/points/'),
    'expected /points/u/:username to rewrite to /points/',
  );
});

test('root legal pages render at root URLs through the MVP SPA', () => {
  assert.ok(
    !hasRule(vercelConfig.redirects, '/privacy', '/points/privacy'),
    'expected /privacy to stop redirecting to /points/privacy',
  );
  assert.ok(
    !hasRule(vercelConfig.redirects, '/terms', '/points/terms'),
    'expected /terms to stop redirecting to /points/terms',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/privacy', '/mvp/'),
    'expected /privacy to rewrite to /mvp/',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/terms', '/mvp/'),
    'expected /terms to rewrite to /mvp/',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/mvp/privacy', '/mvp/'),
    'expected /mvp/privacy to hard-refresh through the MVP SPA',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/mvp/terms', '/mvp/'),
    'expected /mvp/terms to hard-refresh through the MVP SPA',
  );
});
