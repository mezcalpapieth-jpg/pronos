import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const source = JSON.parse(await readFile(new URL('./source.json', import.meta.url), 'utf8'));
if (source.branch !== 'onchain-sepolia' || !/^[a-f0-9]{40}$/.test(source.sha)) throw Error('Only reviewed onchain-sepolia source can build this worker');
await build({
  entryPoints: [existsSync('src/protocol-event-indexer.js') ? 'src/protocol-event-indexer.js' : '../../frontend/api/_lib/protocol-event-indexer.js'], outfile: 'dist/indexer.js',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  nodePaths: [resolve('node_modules')], packages: 'external',
});
