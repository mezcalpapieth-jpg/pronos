import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const adminDirs = [
  'points/admin',
  'protocol/admin',
  'deck/admin',
];

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function isGuardedAdminHandler(source) {
  return /\brequirePointsAdmin\s*\(/.test(source) || /\brequireAdmin\s*\(/.test(source);
}

function isAllowedGuardedReexport(source) {
  return /export\s*\{\s*default\s*\}\s*from\s+['"][^'"]*points\/admin\//.test(source);
}

test('admin API handlers call a server-side admin guard', async () => {
  const files = (await Promise.all(
    adminDirs.map(dir => collectJsFiles(path.join(apiRoot, dir))),
  )).flat();

  const unguarded = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!isGuardedAdminHandler(source) && !isAllowedGuardedReexport(source)) {
      unguarded.push(path.relative(apiRoot, file));
    }
  }

  assert.deepEqual(unguarded, []);
});
