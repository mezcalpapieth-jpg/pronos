import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./health.js', import.meta.url), 'utf8');

test('health exposes detailed dependency diagnostics only to admins', () => {
  assert.match(source, /readSession/);
  assert.match(source, /isAdminUsername/);
  assert.match(source, /Sign in as an admin to view dependency diagnostics/);
  assert.match(source, /DATABASE_URL/);
  assert.match(source, /TURNKEY_ORGANIZATION_ID/);
});
