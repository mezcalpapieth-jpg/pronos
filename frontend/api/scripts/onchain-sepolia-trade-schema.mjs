#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { neon } from '@neondatabase/serverless';
import { pendingApprovalSettings } from '../_lib/onchain-preview-approval.js';
import { isSepoliaGasDatabase } from '../_lib/sepolia-gas-config.js';
import { TRADE_REQUEST_SCHEMA, TRADE_REQUEST_PRIVILEGES } from '../_lib/trade-request-store.js';

const args = process.argv.slice(2);
const migration = [...TRADE_REQUEST_SCHEMA, ...TRADE_REQUEST_PRIVILEGES];
if (!args.includes('--apply')) console.log(`${migration.join(';\n\n')};`);
else {
  const expectedHost = args.find(a => a.startsWith('--expected-host='))?.slice('--expected-host='.length);
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  if (branch !== 'onchain-sepolia' || !pendingApprovalSettings().previewEnabled || !expectedHost
    || expectedHost.includes('-pooler.') || !isSepoliaGasDatabase(process.env.DATABASE_URL)
    || new URL(process.env.DATABASE_URL).hostname !== expectedHost) {
    throw new Error('Require onchain-sepolia preview metadata and the pinned isolated preview direct database host.');
  }
  const sql = neon(process.env.DATABASE_URL);
  await sql.transaction(migration.map(ddl => sql.query(ddl)));
  console.log('Durable trade schema installed. No chain transactions sent.');
}
