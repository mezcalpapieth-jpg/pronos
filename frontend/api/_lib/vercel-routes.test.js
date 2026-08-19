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
const rootIndexHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

function hasRule(rules, source, destination) {
  return Array.isArray(rules)
    && rules.some((rule) => rule.source === source && rule.destination === destination);
}

function hasCron(path, schedule) {
  return Array.isArray(vercelConfig.crons)
    && vercelConfig.crons.some((cron) => cron.path === path && cron.schedule === schedule);
}

test('public user profile route has a root shortcut redirect', () => {
  assert.ok(
    hasRule(vercelConfig.redirects, '/u/:username', '/points/u/:username'),
    'expected /u/:username to redirect to /points/u/:username',
  );
});

test('root redirects to the public points app', () => {
  assert.ok(
    hasRule(vercelConfig.redirects, '/', '/points/'),
    'expected / to redirect to /points/',
  );
  assert.ok(
    /http-equiv=["']refresh["']/i.test(rootIndexHtml),
    'expected frontend/index.html to be a meta-refresh fallback shell',
  );
  assert.match(rootIndexHtml, /\/points\//);
});

test('Mañanera transcript ingestion cron runs at the Mexico City attempt cadence', () => {
  assert.ok(
    hasCron('/api/cron/mananera-transcript', '0 0,3,18,21 * * *'),
    'expected Mañanera ingestion cron at the UTC equivalents of 12/15/18/21 CDMX',
  );
});

test('AICM flight-board oracle cron runs at the evidence collection cadence', () => {
  assert.ok(
    hasCron('/api/cron/aicm-poll', '*/5 * * * *'),
    'expected AICM oracle polling cron every five minutes',
  );
});

test('public user profile route hard-refreshes through the points SPA', () => {
  assert.ok(
    hasRule(vercelConfig.rewrites, '/points/u/:username', '/points/'),
    'expected /points/u/:username to rewrite to /points/',
  );
});

test('root referral route serves a share wrapper while app referral links stay in the points SPA', () => {
  assert.ok(
    hasRule(vercelConfig.rewrites, '/r/:username', '/api/share/referral?username=:username'),
    'expected /r/:username to rewrite to the referral share wrapper',
  );
  assert.ok(
    !hasRule(vercelConfig.redirects, '/r/:username', '/points/r/:username'),
    'expected /r/:username to avoid a crawler-hostile redirect',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/points/r/:username', '/points/'),
    'expected /points/r/:username to rewrite to /points/',
  );
});

test('all points app subroutes hard-refresh through the points SPA', () => {
  assert.ok(
    hasRule(vercelConfig.rewrites, '/points/:path*', '/points/'),
    'expected /points/:path* to rewrite to /points/',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/points/torneo', '/points/')
      || hasRule(vercelConfig.rewrites, '/points/:path*', '/points/'),
    'expected /points/torneo to be covered by an SPA rewrite',
  );
});

test('private deck lives at the root deck path and hard-refreshes through the points SPA', () => {
  assert.ok(
    hasRule(vercelConfig.redirects, '/points/deck', '/deck'),
    'expected /points/deck to redirect to /deck',
  );
  assert.ok(
    hasRule(vercelConfig.redirects, '/investors', '/deck'),
    'expected /investors to redirect to /deck',
  );
  assert.ok(
    hasRule(vercelConfig.rewrites, '/deck', '/points/'),
    'expected /deck to hard-refresh through the points SPA',
  );
});

test('root legal pages redirect into the public points app while MVP legal remains gated under /mvp', () => {
  assert.ok(
    hasRule(vercelConfig.redirects, '/privacy', '/points/privacy'),
    'expected /privacy to redirect to /points/privacy',
  );
  assert.ok(
    hasRule(vercelConfig.redirects, '/terms', '/points/terms'),
    'expected /terms to redirect to /points/terms',
  );
  assert.ok(
    !hasRule(vercelConfig.rewrites, '/privacy', '/mvp/'),
    'expected /privacy to stop rewriting to /mvp/',
  );
  assert.ok(
    !hasRule(vercelConfig.rewrites, '/terms', '/mvp/'),
    'expected /terms to stop rewriting to /mvp/',
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
