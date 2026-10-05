#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import {
  buildOnchainResetPlan,
  parseOnchainResetArgs,
} from '../_lib/onchain-reset-plan.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../../..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function printHelp() {
  console.log(`Usage:
  node frontend/api/scripts/onchain-sepolia-reset.mjs [options]

Builds a dry-run reset/funding plan for the next on-chain Points tournament.
It does not write to Postgres, mint MXNP, or send gas.

Options:
  --allocation=500             MXNP per eligible wallet; default 500
  --gas-eth=0.001              optional gas funding estimate per wallet
  --cycle-label="..."          label for the next tournament cycle
  --starts-at=ISO              cycle start timestamp
  --ends-at=ISO                cycle end timestamp
  --user=frmm,@alexis          limit the audit to one or more usernames
  --limit=5000                 max points_users rows to inspect
  --preview-limit=20           max users shown in previews
  --strict                     exit non-zero if the dry run has blockers
  --apply                      currently rejected; apply mode is not implemented
`);
}

const args = parseOnchainResetArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

loadEnvFile(path.join(repoRoot, '.env'));
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT
    u.username,
    u.wallet_address,
    u.turnkey_sub_org_id,
    u.delegation_policy_id,
    u.delegation_expires_at,
    u.created_at,
    COALESCE(b.balance, 0) AS points_balance
  FROM points_users u
  LEFT JOIN points_balances b ON LOWER(b.username) = LOWER(u.username)
  WHERE u.username IS NOT NULL
  ORDER BY LOWER(u.username)
  LIMIT ${args.limit}
`;

const plan = buildOnchainResetPlan({
  env: process.env,
  users: rows,
  now: new Date(),
  args,
});

console.log(JSON.stringify(plan, null, 2));

if (args.apply) {
  process.exit(1);
}
if (args.strict && !plan.ok) {
  process.exit(1);
}
