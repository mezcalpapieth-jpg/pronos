import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { nodeFileTrace } from '@vercel/nft';

test('Vercel traces official readers, snapshot cron, activation route and Word decompression dependency', async () => {
  const base = fileURLToPath(new URL('../../', import.meta.url));
  const entries = ['api/cron/points-auto-resolve.js', 'api/cron/points-official-snapshots.js', 'api/points/admin/official-contracts.js'];
  const { fileList } = await nodeFileTrace(entries.map(path => `${base}${path}`), { base, processCwd: base });
  for (const entry of entries) assert.ok(fileList.has(entry), `missing entry: ${entry}`);
  for (const lib of ['official-cutoff-snapshots', 'inegi-gdp-release', 'points-cancel-market', 'official-contract-upgrade']) {
    assert.ok(fileList.has(`api/_lib/${lib}.js`), `missing dependency: ${lib}`);
  }
  assert.ok([...fileList].some(path => path.endsWith('fflate/esm/index.mjs')), 'missing fflate Word ZIP parser');
});
