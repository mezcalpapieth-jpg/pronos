import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./start.js', import.meta.url), 'utf8');

test('X OAuth requests follow read and write scopes for verification', () => {
  assert.match(source, /const SCOPES = \[/);
  assert.match(source, /'follows\.read'/);
  assert.match(source, /'follows\.write'/);
  assert.match(source, /'offline\.access'/);
});
