import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { readFile } from 'node:fs/promises';
import { createWorker } from '../worker.js';

let worker;
export default async function handler(req, res) {
  if (!worker) {
    const source = JSON.parse(await readFile(new URL('../source.json', import.meta.url), 'utf8'));
    worker = createWorker({
      env: process.env, source,
      sql: neon(process.env.DATABASE_URL),
      chainId: async () => Number(await new ethers.providers.JsonRpcProvider(process.env.ARB_RPC_URL).send('eth_chainId', [])),
      index: async () => {
        const { runProtocolIndexer } = await import('../dist/indexer.js');
        return runProtocolIndexer({ setupSchema: false });
      },
    });
  }
  return worker(req, res);
}
