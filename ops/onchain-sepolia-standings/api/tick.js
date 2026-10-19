import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { readFile } from 'node:fs/promises';
import { createStandingsWorker } from '../worker.js';

export default async function handler(req,res) {
  // No environment loader and no signing dependency. Disabled invocations do
  // not read policy files, construct database connections or contact the RPC.
  return createStandingsWorker({env:process.env,
    sourceFor:async()=>JSON.parse(await readFile(new URL('../source.json',import.meta.url),'utf8')),
    tick:async({source})=>{
      const policy=JSON.parse(await readFile(new URL('../review.json',import.meta.url),'utf8'));
      const {runStandingsTick}=await import('../dist/automation.js');
      return runStandingsTick({sql:neon(process.env.DATABASE_URL),
        provider:new ethers.providers.JsonRpcProvider({url:process.env.ARB_RPC_URL,timeout:15_000}),
        policy,reviewedPolicyHash:process.env.STANDINGS_POLICY_HASH,sourceSha:source.sha});
    },
  })(req,res);
}
