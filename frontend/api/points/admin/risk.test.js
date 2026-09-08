import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./risk.js', import.meta.url), 'utf8');

test('admin risk endpoint is admin-only and read/review scoped', () => {
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /ensurePointsSchema/);
  assert.match(source, /GET  \/api\/points\/admin\/risk/);
  assert.match(source, /POST \/api\/points\/admin\/risk/);
  assert.match(source, /RISK_REVIEW_STATUSES/);
  assert.match(source, /normalizeRiskReviewStatus/);
  assert.match(source, /USERNAME_RE/);
  assert.match(source, /ON CONFLICT \(username\) DO UPDATE/);
  assert.match(source, /points_account_reviews/);
  assert.match(source, /u\.phone_number AS "phoneNumber"/);
  assert.match(source, /phoneNumber: row\.phoneNumber \|\| null/);
  assert.match(source, /LEFT\(signal_hash, 12\)/);
});

test('admin risk endpoint surfaces loops and shared hashed signals without exposing raw signals', () => {
  assert.match(source, /rapidLoops/);
  assert.match(source, /linkedSignals/);
  assert.match(source, /sameMarketLinks/);
  assert.match(source, /formatRiskTradeRow/);
  assert.match(source, /sharedSignals/);
  assert.match(source, /linkedUsernames/);
  assert.match(source, /points_risk_events/);
  assert.match(source, /hashRiskSignal/);
  assert.match(source, /GENERIC_DEVICE_HINT_VALUES/);
  assert.match(source, /genericDeviceSignalHashes/);
  assert.match(source, /ip_hash/);
  assert.match(source, /device_hash/);
  assert.match(source, /session_hash/);
  assert.match(source, /SELECT username, 'ip' AS signal_type, ip_hash AS signal_hash, created_at/);
  assert.match(source, /SELECT username, 'device' AS signal_type, device_hash AS signal_hash, created_at/);
  assert.match(source, /SELECT username, 'session' AS signal_type, session_hash AS signal_hash, created_at/);
  assert.match(source, /COUNT\(\*\) FILTER \(WHERE side = 'buy'\)/);
  assert.match(source, /COUNT\(\*\) FILTER \(WHERE side = 'sell'\)/);
  assert.match(source, /COALESCE\(tape\.trades, '(\[\]'::jsonb|\\\[\\\]'::jsonb)\)/);
  assert.match(source, /outcomeLabel/);
  assert.match(source, /ABS\(EXTRACT\(EPOCH FROM \(a\.created_at - b\.created_at\)\)\) <= 1800/);
  assert.match(source, /AND NOT \(device_hash = ANY\(\$\{ignoredDeviceHashes\}::text\[\]\)\)/);
  assert.doesNotMatch(source, /SELECT[\s\S]{0,120}ip_address/i);
  assert.doesNotMatch(source, /SELECT[\s\S]{0,120}user_agent/i);
  assert.doesNotMatch(source, /LEFT\(ip_hash, 64\)/);
});

test('admin risk endpoint is non-punitive and excludes the Pronos treasury from evidence', () => {
  assert.match(source, /never moves balances/);
  assert.match(source, /PRONOS_TREASURY_USERNAME/);
  assert.doesNotMatch(source, /UPDATE points_balances/);
  assert.doesNotMatch(source, /DELETE FROM points_positions/);
  assert.doesNotMatch(source, /UPDATE points_positions/);
  assert.doesNotMatch(source, /INSERT INTO points_distributions/);
});
