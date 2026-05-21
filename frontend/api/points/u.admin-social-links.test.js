import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./u.js', import.meta.url), 'utf8');

test('admin public profile payload includes connected social links', () => {
  assert.match(SOURCE, /points_social_links/);
  assert.match(SOURCE, /buildAdminProfileSocialLinks/);
  assert.match(SOURCE, /adminSocialLinks/);
});
