#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { withTransaction } from '../_lib/db-tx.js';
import {
  buildConfirmedTournamentField,
  listTournamentFieldRepairCandidates,
  repairTournamentFieldMarket,
} from '../_lib/points-field-repair.js';

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
    marketIds: [],
  };
  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    else if (arg.startsWith('--market-id=')) {
      const value = arg.slice('--market-id='.length);
      args.marketIds.push(...value.split(',').map(v => Number.parseInt(v, 10)));
    } else if (arg === '--help') {
      args.help = true;
    }
  }
  args.marketIds = args.marketIds.filter(v => Number.isInteger(v) && v > 0);
  return args;
}

function printHelp() {
  console.log(`Usage:
  node frontend/api/scripts/repair-tournament-fields.mjs [--market-id=123,456] [--apply]

Default is a dry run. Pass --apply to write refunds, cancel invalid legs,
add missing confirmed entrants, and patch parent/pending metadata.`);
}

function summarize(results, dryRun) {
  const totalRefunded = results.reduce((sum, row) => sum + Number(row.totalRefunded || 0), 0);
  const refundCount = results.reduce((sum, row) => sum + Number(row.refundCount || 0), 0);
  return {
    dryRun,
    candidates: results.length,
    repaired: results.filter(r => r.ok && !r.skipped).length,
    skipped: results.filter(r => r.skipped).length,
    refundCount,
    totalRefunded,
    results,
  };
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

loadEnvFile(path.join(repoRoot, '.env'));
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not configured.');
  process.exit(1);
}

const dryRun = !args.apply;
const schemaSql = neon(process.env.DATABASE_URL);
await ensurePointsSchema(schemaSql);

const candidates = await withTransaction(async (client) => (
  listTournamentFieldRepairCandidates(client, { marketIds: args.marketIds })
));

const results = [];
for (const market of candidates) {
  const confirmed = await buildConfirmedTournamentField(market);
  const result = await withTransaction(async (client) => (
    repairTournamentFieldMarket(client, market, confirmed, {
      dryRun,
      adminUsername: 'script:field-repair',
    })
  ));
  results.push(result);
}

console.log(JSON.stringify(summarize(results, dryRun), null, 2));
