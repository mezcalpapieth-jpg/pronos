import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./profile.js', import.meta.url), 'utf8');

test('profile endpoint saves only bounded public profile fields for the signed-in user', () => {
  assert.match(source, /POST \/api\/points\/profile/);
  assert.match(source, /requireSession\(req, res\)/);
  assert.match(source, /ensurePointsSchema\(schemaSql\)/);
  assert.match(source, /MAX_DISPLAY_NAME_LENGTH = 60/);
  assert.match(source, /MAX_PROFILE_IMAGE_URL_LENGTH = 800/);
  assert.match(source, /MAX_PHONE_NUMBER_LENGTH = 32/);
  assert.match(source, /UPDATE points_users/);
  assert.match(source, /WHERE turnkey_sub_org_id = \$\{session\.sub\}/);
  assert.match(source, /phone_number = \$\{phoneNumber\}/);
  assert.match(source, /profile_updated_at = NOW\(\)/);
  assert.match(source, /RETURNING username, email, display_name, profile_image_url, phone_number, profile_updated_at/);
  assert.match(source, /phoneNumber: row\.phone_number \|\| null/);
});

test('profile endpoint rejects unsafe display names and non-web image urls', () => {
  assert.match(source, /invalid_display_name/);
  assert.match(source, /invalid_profile_image_url/);
  assert.match(source, /invalid_phone_number/);
  assert.match(source, /\/\[\\u0000-\\u001f\\u007f\]\//);
  assert.match(source, /new URL\(text\)/);
  assert.match(source, /url\.protocol !== 'http:' && url\.protocol !== 'https:'/);
  assert.match(source, /digits\.length < 7/);
  assert.match(source, /digits\.length > 15/);
  assert.match(source, /profile_update_failed/);
});
