#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import {
  normalizeInvalidParallelLegRequest,
  voidInvalidParallelLeg,
} from '../_lib/points-invalid-parallel-leg.js';

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

function parseArgs(argv) {
  const args = {
    apply: false,
    marketId: null,
    parentMarketId: null,
    legLabel: '',
    reason: '',
  };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--market-id=')) args.marketId = arg.slice('--market-id='.length);
    else if (arg.startsWith('--leg-id=')) args.marketId = arg.slice('--leg-id='.length);
    else if (arg.startsWith('--parent-id=')) args.parentMarketId = arg.slice('--parent-id='.length);
    else if (arg.startsWith('--label=')) args.legLabel = arg.slice('--label='.length);
    else if (arg.startsWith('--reason=')) args.reason = arg.slice('--reason='.length);
    else if (arg === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node frontend/api/scripts/void-invalid-parallel-leg.mjs --market-id=161983 [--reason="Reembolso: nominada invalida"] [--apply]
  node frontend/api/scripts/void-invalid-parallel-leg.mjs --parent-id=161979 --label="Flor Vigna" [--apply]

Default is a dry run. Pass --apply to cancel only the selected parallel leg,
refund its open cost basis, and remove it from the parent outcomes.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const normalized = normalizeInvalidParallelLegRequest(args);
if (normalized.error) {
  printHelp();
  console.error(`\nError: ${normalized.error}`);
  process.exit(1);
}

loadEnvFile(path.join(repoRoot, '.env'));
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}

const dryRun = !args.apply;
const schemaSql = neon(process.env.DATABASE_URL);
await ensurePointsSchema(schemaSql);

const result = await withTransaction(async (client) => (
  voidInvalidParallelLeg(client, {
    ...normalized,
    dryRun,
    adminUsername: 'script:invalid-leg-void',
  })
));

console.log(JSON.stringify(result, null, 2));
