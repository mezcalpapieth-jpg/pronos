// Explicit, preview-only migration. Never imported by HTTP request paths.
import { neon } from '@neondatabase/serverless';
import { execFileSync } from 'node:child_process';
import { settlementSettings, SETTLEMENT_MIGRATION } from '../_lib/onchain-admin-settlement.js';
import { RESOLVER_MIGRATION } from '../_lib/sepolia-resolver.js';
import { isSepoliaGasDatabase } from '../_lib/sepolia-gas-config.js';

if (process.argv.slice(2).join(' ') !== '--apply-preview') throw Error('Explicit --apply-preview required');
if (execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim() !== 'onchain-sepolia'
  || process.env.VERCEL_GIT_COMMIT_REF !== 'onchain-sepolia' || process.env.VERCEL_ENV !== 'preview'
  || process.env.ONCHAIN_CHAIN_ID !== '421614' || !isSepoliaGasDatabase(process.env.DATABASE_URL)
  || new URL(process.env.DATABASE_URL).pathname !== '/neondb') throw Error('isolated_sepolia_preview_required');
const db = new URL(process.env.DATABASE_URL);
if (db.hostname.includes('-pooler')) throw Error('direct_preview_migration_connection_required');
const sql = neon(process.env.DATABASE_URL);
await sql.transaction([...SETTLEMENT_MIGRATION,...RESOLVER_MIGRATION].map(s => sql.query(s)));
console.log(JSON.stringify({ migrated: true, enabled: settlementSettings().enabled, transactionsSubmitted: false }));
