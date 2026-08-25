import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./u.js', import.meta.url), 'utf8');

test('admin public profile payload includes connected social links', () => {
  assert.match(SOURCE, /points_social_links/);
  assert.match(SOURCE, /ensurePointsSocialLinksSchema/);
  assert.match(SOURCE, /buildAdminProfileSocialLinks/);
  assert.match(SOURCE, /adminSocialLinks/);
  assert.match(SOURCE, /reward_credited, is_public, source, linked_at, updated_at/);
  assert.match(SOURCE, /WHERE LOWER\(username\) = LOWER\(\$\{username\}\)/);
});

test('admin-only social profile data cannot break the public profile response', () => {
  assert.match(SOURCE, /const socialSql = neon\(process\.env\.DATABASE_URL \|\| process\.env\.DATABASE_READ_URL\)/);
  assert.match(SOURCE, /try\s*\{\s*const socialRows = await sql/);
  assert.match(SOURCE, /const socialLinkRows = await socialSql/);
  assert.match(SOURCE, /catch \(socialError\)/);
  assert.match(SOURCE, /\[points\/u\] admin_socials_failed/);
  assert.match(SOURCE, /adminSocials = \[\]/);
  assert.match(SOURCE, /adminSocialLinks = \[\]/);
});

test('public profile only exposes social handles users marked public', () => {
  assert.match(SOURCE, /buildPublicProfileSocialLinks/);
  assert.match(SOURCE, /socialLinks: publicSocialLinks/);
  assert.match(SOURCE, /const publicSocialRows = await socialSql/);
  assert.match(SOURCE, /SELECT provider, handle, profile_url, is_public, source, linked_at, updated_at/);
  assert.match(SOURCE, /AND is_public = true/);
  assert.match(SOURCE, /\[points\/u\] public_socials_failed/);
  assert.match(SOURCE, /publicSocialLinks = \[\]/);
});

test('public profile exposes display identity and keeps email admin-only', () => {
  assert.match(SOURCE, /display_name/);
  assert.match(SOURCE, /profile_image_url/);
  assert.match(SOURCE, /displayName: userRow\[0\]\.display_name \|\| null/);
  assert.match(SOURCE, /profileImageUrl: userRow\[0\]\.profile_image_url \|\| null/);
  assert.match(SOURCE, /adminEmail: userRow\[0\]\.email \|\| null/);
  assert.match(SOURCE, /\.\.\.\(viewerIsAdmin \? \{ adminEmail/);
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

test('public profile payload includes the searched user current balance', () => {
  assert.match(SOURCE, /const balanceRows = await sql/);
  assert.match(SOURCE, /SELECT balance/);
  assert.match(SOURCE, /const currentBalance = round2/);
  assert.match(SOURCE, /balance: currentBalance/);
  assert.match(SOURCE, /currentBalance/);
});
