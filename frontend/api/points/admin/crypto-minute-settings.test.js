import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./crypto-minute-settings.js', import.meta.url), 'utf8');

test('saving crypto settings immediately seeds the current and upcoming windows', () => {
  assert.match(source, /catchUpCurrentPendingCryptoMarkets/);
  assert.match(source, /ensureUpcomingCryptoMarkets/);
  assert.match(source, /readGeneratedCryptoHiddenFromHome/);
  assert.match(source, /hiddenFromHome: generatedHiddenFromHome/);
  assert.match(source, /generationError/);
});
