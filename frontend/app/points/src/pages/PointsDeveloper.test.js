import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const earnSource = await readFile(new URL('./PointsEarn.jsx', import.meta.url), 'utf8');
const developerSource = await readFile(new URL('./PointsDeveloper.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');
const rootVercelSource = await readFile(new URL('../../../../../vercel.json', import.meta.url), 'utf8');
const frontendVercelSource = await readFile(new URL('../../../../vercel.json', import.meta.url), 'utf8');

test('developer page is reachable from top-level and points routes', () => {
  assert.match(appSource, /const PointsDeveloper = lazy\(\(\) => import\('\.\/pages\/PointsDeveloper\.jsx'\)\)/);
  assert.match(appSource, /<Route path="\/developer" element=\{<PointsDeveloper onOpenLogin=\{onOpenLogin\} \/>\} \/>/);
  for (const source of [rootVercelSource, frontendVercelSource]) {
    assert.match(source, /"source": "\/developer"[\s\S]*?"destination": "\/points\/"/);
    assert.match(source, /"source": "\/points\/developer"[\s\S]*?"destination": "\/points\/"/);
  }
});

test('Perfil page and account menu link users to API key creation', () => {
  assert.match(i18nSource, /'points\.nav\.earn':\s*\{\s*es:\s*'Perfil',\s*en:\s*'Profile'/);
  assert.match(i18nSource, /'points\.earn\.title':\s*\{\s*es:\s*'Perfil',\s*en:\s*'Profile'/);
  assert.match(i18nSource, /'points\.nav\.developer':\s*\{\s*es:\s*'Crear API key',\s*en:\s*'Create API key'/);
  assert.match(earnSource, /function DeveloperApiCard\(\)/);
  assert.match(earnSource, /to="\/developer"/);
  assert.match(earnSource, /user\?\.phoneRequired/);
  assert.match(earnSource, /user\?\.apiBlockedAt/);
  assert.match(navSource, /to="\/developer"[\s\S]*?points\.nav\.developer/);
});

test('developer page manages API keys and documents HMAC authentication', () => {
  assert.match(developerSource, /fetchApiKeys/);
  assert.match(developerSource, /createApiKey/);
  assert.match(developerSource, /revokeApiKey/);
  assert.match(developerSource, /apiBlocked/);
  assert.match(developerSource, /phoneRequired/);
  assert.match(developerSource, /Acceso API bloqueado|API access blocked/);
  assert.match(developerSource, /Verificación telefónica solicitada|Phone verification requested/);
  assert.match(developerSource, /created\?\.apiSecret/);
  assert.match(developerSource, /X-PRONOS-API-KEY/);
  assert.match(developerSource, /X-PRONOS-TIMESTAMP/);
  assert.match(developerSource, /X-PRONOS-SIGNATURE/);
  assert.match(developerSource, /HMAC-SHA256/);
  assert.match(developerSource, /Idempotency-Key/);
  assert.match(developerSource, /Phone verification|Verificacion telefonica/);
});

test('points API client exposes session key helpers', () => {
  assert.match(apiSource, /export async function fetchApiKeys\(\)/);
  assert.match(apiSource, /export async function createApiKey\(\{ name, permissions = \['READ'\], expiresAt = null \} = \{\}\)/);
  assert.match(apiSource, /export async function revokeApiKey\(id\)/);
  assert.match(apiSource, /api_access_blocked/);
  assert.match(apiSource, /export async function deleteJson\(url, body\)/);
  assert.match(apiSource, /\/api\/points\/api-keys/);
});
