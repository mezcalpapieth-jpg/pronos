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
