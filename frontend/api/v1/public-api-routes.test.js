import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const buyRoute = await readFile(new URL('../points/buy.js', import.meta.url), 'utf8');
const sellRoute = await readFile(new URL('../points/sell.js', import.meta.url), 'utf8');
const tradeRoute = await readFile(new URL('./trades.js', import.meta.url), 'utf8');
const authHelper = await readFile(new URL('../_lib/points-api-auth.js', import.meta.url), 'utf8');
const keyRoute = await readFile(new URL('../points/api-keys.js', import.meta.url), 'utf8');

test('web and public api trades use the same trading service', () => {
  assert.match(buyRoute, /executePointsBuy/);
  assert.match(sellRoute, /executePointsSell/);
  assert.match(tradeRoute, /executePointsBuy/);
  assert.match(tradeRoute, /executePointsSell/);
  assert.match(tradeRoute, /source:\s*'api'/);
  assert.match(buyRoute, /source:\s*'web'/);
  assert.match(sellRoute, /source:\s*'web'/);
});

test('public api trade route requires idempotency and records request ownership', () => {
  assert.match(tradeRoute, /Idempotency-Key/);
  assert.match(tradeRoute, /points_api_idempotency_keys/);
  assert.match(tradeRoute, /bodyParser:\s*false/);
  assert.match(tradeRoute, /readRawRequestBody/);
  assert.match(tradeRoute, /stableApiRequestHash/);
  assert.match(tradeRoute, /apiKeyId:\s*auth\.apiKeyId/);
  assert.match(tradeRoute, /recordApiRequest/);
});

test('public api auth signs requests without returning stored secrets', () => {
  assert.match(authHelper, /X-PRONOS-API-KEY/);
  assert.match(authHelper, /X-PRONOS-TIMESTAMP/);
  assert.match(authHelper, /X-PRONOS-SIGNATURE/);
  assert.match(authHelper, /createHmac\('sha256'/);
  assert.match(authHelper, /timingSafeEqual/);
  assert.match(keyRoute, /createApiCredentials/);
  assert.match(keyRoute, /apiSecret/);
  assert.doesNotMatch(keyRoute, /secretCiphertext[^\n]*json/);
  assert.doesNotMatch(keyRoute, /secretHash[^\n]*json/);
});

test('public api auth blocks account-level API access before signed requests execute', () => {
  assert.match(authHelper, /LEFT JOIN points_users u/);
  assert.match(authHelper, /u\.api_blocked_at/);
  assert.match(authHelper, /api_access_blocked/);
  assert.match(keyRoute, /getAccountAccessState/);
  assert.match(keyRoute, /apiBlockedAt/);
  assert.match(keyRoute, /phoneRequired/);
});
