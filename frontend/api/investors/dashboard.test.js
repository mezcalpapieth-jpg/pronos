import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./dashboard.js', import.meta.url), 'utf8');

test('investor dashboard endpoint is protected by the private deck session', () => {
  assert.match(source, /ensureDeckSchema/);
  assert.match(source, /readDeckSession/);
  assert.match(source, /investor_session_required/);
  assert.match(source, /ensurePointsSchema/);
  assert.match(source, /scope:\s*'private'/);
});

test('investor dashboard exposes aggregate metrics without user PII rows', () => {
  assert.match(source, /aggregateOnly:\s*true/);
  assert.match(source, /userRows:\s*false/);
  assert.match(source, /piiFields:\s*\[\]/);
  assert.match(source, /PRONOS_TREASURY_USERNAME/);
  assert.match(source, /t\.username <>/);
  assert.match(source, /COUNT\(DISTINCT username\)/);
  assert.match(source, /points_publicity_daily/);
  assert.match(source, /points_site_time_daily/);
  assert.match(source, /points_parlay_tickets/);
  assert.match(source, /points_resolution_corrections/);
  assert.match(source, /points_distributions/);
  assert.doesNotMatch(source, /userSignups/);
  assert.doesNotMatch(source, /viewerEmail/);
  assert.doesNotMatch(source, /phoneNumber/);
  assert.doesNotMatch(source, /phone_number/);
  assert.doesNotMatch(source, /email:/);
  assert.doesNotMatch(source, /u\.email/);
});
