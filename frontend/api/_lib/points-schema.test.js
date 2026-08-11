import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./points-schema.js', import.meta.url), 'utf8');

test('points schema self-healing avoids hot-route migration lock pileups', () => {
  assert.match(source, /POINTS_SCHEMA_READY_PROBE/);
  assert.match(source, /to_regclass\('public\.points_publicity_daily'\)/);
  assert.match(source, /to_regclass\('public\.points_resolution_candidates'\)/);
  assert.match(source, /to_regclass\('public\.points_pwa_install_claims'\) IS NOT NULL AS points_pwa_install_claims/);
  assert.match(source, /to_regclass\('public\.points_social_links'\) IS NOT NULL AS points_social_links/);
  assert.match(source, /to_regclass\('public\.points_mananera_transcripts'\) IS NOT NULL AS points_mananera_transcripts/);
  assert.match(source, /points_support_message_attachments/);
  assert.match(source, /points_social_links_is_public/);
  assert.match(source, /points_social_links_source/);
  assert.match(source, /points_social_links_updated_at/);
  assert.match(source, /points_social_links_access_token_ciphertext/);
  assert.match(source, /points_social_links_token_expires_at/);
  assert.match(source, /points_support_messages[\s\S]+ADD COLUMN IF NOT EXISTS attachments JSONB/);
  assert.match(source, /POINTS_SCHEMA_LOCK_TABLE/);
  assert.match(source, /points_schema_locks/);
  assert.match(source, /locked_until/);
  assert.match(source, /ON CONFLICT \(name\) DO UPDATE/);
  assert.match(source, /if \(!acquired\) \{/);
  assert.match(source, /return;\s*\n\s*\}/);
  assert.match(source, /runSchemaMigration/);
  assert.match(source, /SET LOCAL lock_timeout/);
  assert.match(source, /deadlock_detected/);
  assert.match(source, /lock_not_available/);
  assert.match(source, /statement_timeout/);
});

test('points schema stores official Mañanera transcripts by local date', () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS points_mananera_transcripts/);
  assert.match(source, /date_ymd\s+DATE PRIMARY KEY/);
  assert.match(source, /raw_html_gzip\s+BYTEA NOT NULL/);
  assert.match(source, /transcript_text\s+TEXT NOT NULL/);
  assert.match(source, /speakers\s+JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(source, /turns\s+JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(source, /idx_points_mananera_transcripts_fetched/);
});

test('points social links schema supports private-by-default public handles', () => {
  assert.match(source, /CREATE TABLE IF NOT EXISTS points_social_links/);
  assert.match(source, /is_public\s+BOOLEAN NOT NULL DEFAULT false/);
  assert.match(source, /source\s+TEXT NOT NULL DEFAULT 'oauth'/);
  assert.match(source, /access_token_ciphertext\s+TEXT/);
  assert.match(source, /refresh_token_ciphertext\s+TEXT/);
  assert.match(source, /token_expires_at\s+TIMESTAMPTZ/);
  assert.match(source, /token_scope\s+TEXT/);
  assert.match(source, /updated_at\s+TIMESTAMPTZ DEFAULT NOW\(\)/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'oauth'/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW\(\)/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS access_token_ciphertext TEXT/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS refresh_token_ciphertext TEXT/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ/);
  assert.match(source, /ALTER TABLE points_social_links ADD COLUMN IF NOT EXISTS token_scope TEXT/);
  assert.match(source, /idx_points_social_links_public_user/);
  assert.match(source, /ON points_social_links\(username, is_public\)/);
});
