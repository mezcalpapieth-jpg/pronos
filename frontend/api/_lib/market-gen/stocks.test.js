import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nextFridayStockCloseUtc } from './stocks.js';

const source = await readFile(new URL('./stocks.js', import.meta.url), 'utf8');

test('stock markets close on Friday at the US equity cutoff, not Sunday', () => {
  assert.match(source, /nextFridayStockCloseUtc/);
  assert.match(source, /America\/New_York/);
  assert.match(source, /hour:\s*15/);
  assert.match(source, /minute:\s*59/);
  assert.match(source, /formatMexicoDateYmd\(end\)/);
  assert.match(source, /formatMexicoDateEs\(end\)/);
  assert.doesNotMatch(source, /nextSundayEndUtc/);
});

test('stock market cutoff resolves to Friday 3:59 p.m. New York time', () => {
  const cutoff = nextFridayStockCloseUtc(new Date('2026-08-13T16:00:00.000Z'));
  assert.equal(cutoff.toISOString(), '2026-08-14T19:59:00.000Z');
});
