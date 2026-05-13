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
