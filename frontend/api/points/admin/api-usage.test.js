import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./api-usage.js', import.meta.url), 'utf8');

test('admin api usage endpoint is admin-only and schema-aware', () => {
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /ensurePointsSchema/);
  assert.match(source, /methods: 'GET, POST, OPTIONS'/);
  assert.match(source, /method_not_allowed/);
});

test('admin api usage endpoint exposes evaluation data without credential material', () => {
  assert.match(source, /points_api_keys/);
  assert.match(source, /points_api_request_logs/);
  assert.match(source, /requests_24h/);
  assert.match(source, /requests_7d/);
  assert.match(source, /trade_requests_24h/);
  assert.match(source, /errors_24h/);
  assert.match(source, /distinct_ip_hashes_7d/);
  assert.match(source, /last_endpoint/);
  assert.match(source, /metadata/);
  assert.match(source, /key_prefix/);
  assert.match(source, /api_blocked_at/);
  assert.match(source, /api_block_reason/);
  assert.doesNotMatch(source, /secret_hash/);
  assert.doesNotMatch(source, /secret_ciphertext/);
  assert.doesNotMatch(source, /user_agent_hash/);
});

test('admin api usage endpoint can block account-level API access without exposing secrets', () => {
  assert.match(source, /block_user_api/);
  assert.match(source, /unblock_user_api/);
  assert.match(source, /UPDATE points_users[\s\S]+api_blocked_at/);
  assert.match(source, /UPDATE points_api_keys[\s\S]+revoked_at/);
  assert.match(source, /revokedKeys/);
  assert.match(source, /invalid_username/);
  assert.match(source, /user_not_found/);
});
