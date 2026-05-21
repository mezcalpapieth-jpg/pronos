import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./callback.js', import.meta.url), 'utf8');

test('X callback delegates token exchange to the shared helper', () => {
  assert.match(source, /exchangeXAuthorizationCode/);
  assert.doesNotMatch(source, /!clientId \|\| !clientSecret/);
});
