import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const callbacks = [
  ['x', './x/callback.js'],
  ['instagram', './instagram/callback.js'],
  ['tiktok', './tiktok/callback.js'],
];

for (const [provider, path] of callbacks) {
  test(`${provider} callback repairs social-link schema before persisting`, async () => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /ensurePointsSocialLinksSchema/);
    assert.match(source, /await ensurePointsSchema\(schemaSql\);\s*\n\s*await ensurePointsSocialLinksSchema\(schemaSql\);/);
    assert.match(source, /INSERT INTO points_social_links/);
  });
}

test('x callback stores encrypted OAuth token material for follow verification', async () => {
  const source = await readFile(new URL('./x/callback.js', import.meta.url), 'utf8');
  assert.match(source, /encryptOAuthToken/);
  assert.match(source, /access_token_ciphertext/);
  assert.match(source, /refresh_token_ciphertext/);
  assert.match(source, /token_expires_at/);
  assert.match(source, /token_scope/);
  assert.match(source, /REQUESTED_SCOPE = 'users\.read follows\.read follows\.write tweet\.read offline\.access'/);
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^)]*accessToken/);
});
