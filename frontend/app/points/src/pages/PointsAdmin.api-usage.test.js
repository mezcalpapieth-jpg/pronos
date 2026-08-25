import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('admin has an API usage tab backed by the admin endpoint', () => {
  assert.match(adminSource, /adminListApiUsage/);
  assert.match(adminSource, /\['create', 'markets', 'stats', 'pending', 'social', 'support', 'deck', 'cycles', 'risk', 'api'\]/);
  assert.match(adminSource, /\{ id: 'api',\s+label: 'API' \}/);
  assert.match(adminSource, /tab === 'api' && <ApiUsagePanel \/>/);
  assert.match(apiSource, /export async function adminListApiUsage\(\)/);
  assert.match(apiSource, /\/api\/points\/admin\/api-usage/);
});

test('admin API usage panel shows request shape and avoids raw hashes', () => {
  assert.match(adminSource, /function ApiUsagePanel\(\)/);
  assert.match(adminSource, /Uso por API key/);
  assert.match(adminSource, /Requests recientes/);
  assert.match(adminSource, /distinctIpHashes7d/);
  assert.match(adminSource, /apiMetadataSummary/);
  assert.match(adminSource, /statusCode/);
  assert.match(adminSource, /errorCode/);
  assert.doesNotMatch(adminSource, /ip_hash/);
  assert.doesNotMatch(adminSource, /user_agent_hash/);
  assert.doesNotMatch(adminSource, /secret_ciphertext/);
});
