#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import { pendingApprovalSettings } from '../_lib/onchain-preview-approval.js';
import { SEPOLIA_GAS_SCHEMA } from '../_lib/sepolia-gas-store.js';
import { isSepoliaGasDatabase } from '../_lib/sepolia-gas-config.js';

const args = process.argv.slice(2);
if (!args.includes('--apply')) {
  console.log(`${SEPOLIA_GAS_SCHEMA.join(';\n\n')};`);
} else {
  // Require an explicit destination even when DATABASE_URL is inherited.
  const expectedHost = args.find(a => a.startsWith('--expected-host='))?.slice('--expected-host='.length);
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (branch !== 'onchain-sepolia' || !pendingApprovalSettings().previewEnabled || !expectedHost
    || !isSepoliaGasDatabase(process.env.DATABASE_URL)
    || expectedHost.includes('-pooler.')
    || new URL(process.env.DATABASE_URL).hostname !== expectedHost) {
    throw new Error('Refusing migration: require onchain-sepolia preview metadata and the pinned isolated preview direct database host.');
  }
  const sql = neon(process.env.DATABASE_URL);
  await sql.transaction(SEPOLIA_GAS_SCHEMA.map(ddl => sql.query(ddl)));
  console.log('Sepolia gas funding schema installed. No transactions sent.');
}
