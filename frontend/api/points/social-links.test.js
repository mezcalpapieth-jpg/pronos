import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./social-links.js', import.meta.url), 'utf8');

test('social links endpoint supports private-by-default manual handle saves', () => {
  assert.match(SOURCE, /GET \/api\/points\/social-links/);
  assert.match(SOURCE, /POST \/api\/points\/social-links/);
  assert.match(SOURCE, /GET, POST, OPTIONS/);
  assert.match(SOURCE, /ensurePointsSocialLinksSchema/);
  assert.match(SOURCE, /manual:\$\{username\}:\$\{provider\}/);
  assert.match(SOURCE, /is_public/);
  assert.match(SOURCE, /source/);
  assert.match(SOURCE, /canEditHandle/);
  assert.match(SOURCE, /invalid_handle/);
  assert.match(SOURCE, /profileUrlFor/);
});

test('social links endpoint keeps oauth rows verified while allowing public visibility edits', () => {
  assert.match(SOURCE, /social-link reads on that same connection/);
  assert.match(SOURCE, /const rows = await writeSql`/);
  assert.match(SOURCE, /const existingSource = String\(existing\?\.source \|\| 'oauth'\)/);
  assert.match(SOURCE, /const canEditHandle = !existing \|\| existingSource === 'manual'/);
  assert.match(SOURCE, /is_public = \$\{wantsPublic\}/);
  assert.match(SOURCE, /verified: source === 'oauth'/);
});
