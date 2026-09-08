import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./me.js', import.meta.url), 'utf8');

test('auth/me returns the signed-in user private profile fields', () => {
  assert.match(source, /GET \/api\/points\/auth\/me/);
  assert.match(source, /u\.display_name, u\.profile_image_url, u\.phone_number/);
  assert.match(source, /displayName: r\.display_name \|\| null/);
  assert.match(source, /profileImageUrl: r\.profile_image_url \|\| null/);
  assert.match(source, /phoneNumber: r\.phone_number \|\| null/);
  assert.match(source, /phoneRequired: reviewStatus === 'phone_required'/);
});
