import { readFile } from 'node:fs/promises';
import { createResolverWorker } from '../worker.js';
export default createResolverWorker({ env:process.env,
  sourceFor:async()=>JSON.parse(await readFile(new URL('../source.json',import.meta.url),'utf8')) });
