/**
 * Run with:
 *   node --test frontend/api/share/market.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./market.js', import.meta.url), 'utf8');

test('market share wrapper forwards ticket params to the OG image only', () => {
  assert.match(source, /OG_PARAM_ALLOWLIST/);
  assert.match(source, /'account'/);
  assert.match(source, /'cashout'/);
  assert.match(source, /'cost'/);
  assert.match(source, /'odds'/);
  assert.match(source, /'outcome'/);
  assert.match(source, /appendOgParams\(new URL\(`\$\{baseUrl\}\/api\/og\/market\?id=\$\{id\}`\), req\.query\)/);
  assert.match(source, /const canonicalUrl = `\$\{baseUrl\}\$\{targetPath\}`/);
});
