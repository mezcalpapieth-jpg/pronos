import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./points-schema.js', import.meta.url), 'utf8');
const migrateSource = await readFile(new URL('../migrate.js', import.meta.url), 'utf8');

test('points schema self-healing avoids hot-route migration lock pileups', () => {
  assert.match(source, /POINTS_SCHEMA_READY_PROBE/);
  assert.match(source, /to_regclass\('public\.points_publicity_daily'\)/);
  assert.match(source, /to_regclass\('public\.points_resolution_candidates'\)/);
  assert.match(source, /to_regclass\('public\.points_resolver_checkpoints'\) IS NOT NULL AS points_resolver_checkpoints/);
  assert.match(source, /to_regclass\('public\.points_pwa_install_claims'\) IS NOT NULL AS points_pwa_install_claims/);
  assert.match(source, /to_regclass\('public\.points_social_links'\) IS NOT NULL AS points_social_links/);
  assert.match(source, /to_regclass\('public\.points_mananera_transcripts'\) IS NOT NULL AS points_mananera_transcripts/);
  assert.match(source, /to_regclass\('public\.points_aicm_poll_runs'\) IS NOT NULL AS points_aicm_poll_runs/);
  assert.match(source, /to_regclass\('public\.points_aicm_flight_observations'\) IS NOT NULL AS points_aicm_flight_observations/);
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

test('points schema stores resolver checkpoints off market rows', () => {
  for (const migrationSource of [source, migrateSource]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_resolver_checkpoints/);
    assert.match(migrationSource, /PRIMARY KEY \(market_id, checkpoint_key\)/);
    assert.match(migrationSource, /idx_points_resolver_checkpoints_key_checked/);
  }
});

test('points schema keeps market data backfills out of hot migrations', () => {
  const migrationsStart = source.indexOf('const POINTS_SCHEMA_MIGRATIONS = [');
  const backfillsStart = source.indexOf('export const POINTS_MARKET_DATA_BACKFILLS');
  assert.ok(migrationsStart >= 0);
  assert.ok(backfillsStart > migrationsStart);

  const migrationBody = source.slice(migrationsStart, backfillsStart);
  assert.doesNotMatch(migrationBody, /UPDATE\s+points_markets/i);
  assert.doesNotMatch(migrationBody, /UPDATE\s+points_pending_markets/i);

  assert.match(source, /export const POINTS_MARKET_DATA_BACKFILLS/);
  assert.match(source, /export async function runPointsMarketDataBackfills/);
  assert.match(source, /IS DISTINCT FROM/);
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

test('points schema stores AICM oracle evidence separately from markets', () => {
  for (const migrationSource of [source, migrateSource]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_aicm_poll_runs/);
    assert.match(migrationSource, /source\s+TEXT NOT NULL DEFAULT 'aicm-official-flight-board'/);
    assert.match(migrationSource, /status\s+TEXT NOT NULL CHECK \(status IN \('ok', 'empty', 'maintenance', 'no_table', 'http_error', 'fetch_error'\)\)/);
    assert.match(migrationSource, /raw_html_sha256\s+TEXT/);
    assert.match(migrationSource, /rows_capped\s+BOOLEAN NOT NULL DEFAULT false/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_aicm_flight_observations/);
    assert.match(migrationSource, /UNIQUE\(flight_key, status_norm\)/);
    assert.match(migrationSource, /raw_cells\s+JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    assert.match(migrationSource, /idx_points_aicm_poll_runs_direction_observed/);
    assert.match(migrationSource, /idx_points_aicm_observations_date_status/);
  }
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

test('points schema stores non-punitive risk review signals for admins', () => {
  assert.match(source, /to_regclass\('public\.points_risk_events'\) IS NOT NULL AS points_risk_events/);
  assert.match(source, /to_regclass\('public\.points_account_reviews'\) IS NOT NULL AS points_account_reviews/);
  assert.match(source, /to_regclass\('public\.points_risk_flags'\) IS NOT NULL AS points_risk_flags/);
  for (const migrationSource of [source, migrateSource]) {
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_risk_events/);
    assert.match(migrationSource, /account_hash\s+TEXT/);
    assert.match(migrationSource, /ip_hash\s+TEXT/);
    assert.match(migrationSource, /user_agent_hash\s+TEXT/);
    assert.match(migrationSource, /device_hash\s+TEXT/);
    assert.match(migrationSource, /session_hash\s+TEXT/);
    assert.match(migrationSource, /metadata\s+JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    assert.match(migrationSource, /idx_points_risk_events_user_time/);
    assert.match(migrationSource, /idx_points_risk_events_ip_hash/);
    assert.match(migrationSource, /idx_points_risk_events_device_hash/);
    assert.match(migrationSource, /idx_points_risk_events_session_hash/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_account_reviews/);
    assert.match(migrationSource, /CHECK \(status IN \('clear', 'watch', 'phone_required', 'under_review', 'ineligible'\)\)/);
    assert.match(migrationSource, /idx_points_account_reviews_status/);
    assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS points_risk_flags/);
    assert.match(migrationSource, /CHECK \(status IN \('open', 'acknowledged', 'closed'\)\)/);
    assert.match(migrationSource, /idx_points_risk_flags_status_severity/);
  }
  assert.match(source, /never debit balances or alter positions/);
});
