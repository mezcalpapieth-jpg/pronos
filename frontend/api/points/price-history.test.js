import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./price-history.js', import.meta.url), 'utf8');

test('points price history supports short hour windows for detail charts', () => {
  assert.match(source, /GET \/api\/points\/price-history\?ids=1,2,3&hours=4/);
  assert.match(source, /const hoursRaw = parseInt\(req\.query\.hours, 10\)/);
  assert.match(source, /const windowHours = Number\.isInteger\(hoursRaw\)/);
  assert.match(source, /\|\| ' hours'/);
});
