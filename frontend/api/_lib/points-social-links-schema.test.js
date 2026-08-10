import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./points-social-links-schema.js', import.meta.url), 'utf8');

test('social links schema guard self-heals privacy columns independently', () => {
  assert.match(source, /SOCIAL_LINKS_SCHEMA_READY_PROBE/);
  assert.match(source, /to_regclass\('public\.points_social_links'\) IS NOT NULL AS points_social_links/);
  assert.match(source, /points_social_links_is_public/);
  assert.match(source, /points_social_links_source/);
  assert.match(source, /points_social_links_updated_at/);
  assert.match(source, /points_social_links_access_token_ciphertext/);
  assert.match(source, /points_social_links_token_expires_at/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS points_social_links/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'oauth'/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW\(\)/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS access_token_ciphertext TEXT/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS refresh_token_ciphertext TEXT/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS token_scope TEXT/);
  assert.match(source, /idx_points_social_links_public_user/);
});
