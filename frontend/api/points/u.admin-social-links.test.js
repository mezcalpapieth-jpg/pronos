import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./u.js', import.meta.url), 'utf8');

test('admin public profile payload includes connected social links', () => {
  assert.match(SOURCE, /points_social_links/);
  assert.match(SOURCE, /buildAdminProfileSocialLinks/);
  assert.match(SOURCE, /adminSocialLinks/);
});

test('admin-only social profile data cannot break the public profile response', () => {
  assert.match(SOURCE, /try\s*\{\s*const socialRows = await sql/);
  assert.match(SOURCE, /catch \(socialError\)/);
  assert.match(SOURCE, /\[points\/u\] admin_socials_failed/);
  assert.match(SOURCE, /adminSocials = \[\]/);
  assert.match(SOURCE, /adminSocialLinks = \[\]/);
});

test('public profile lookup falls back to public points activity rows', () => {
  assert.match(SOURCE, /WITH candidates AS/);
  assert.match(SOURCE, /FROM points_balances/);
  assert.match(SOURCE, /FROM points_trades/);
  assert.match(SOURCE, /FROM points_positions/);
  assert.match(SOURCE, /FROM points_distributions/);
  assert.match(SOURCE, /FROM points_cycle_snapshots/);
  assert.match(SOURCE, /ORDER BY priority ASC/);
});
