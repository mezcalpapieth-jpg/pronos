import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./bulk-hide-markets.js', import.meta.url), 'utf8');

test('bulk hide also marks direct-generated pending rows before they activate', () => {
  assert.match(source, /status IN \('active', 'pending'\)/);
  assert.match(source, /hidden_from_home = true/);
  assert.match(source, /hidden_from_home = false/);
});
