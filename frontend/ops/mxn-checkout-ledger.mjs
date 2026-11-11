import { readFile, stat } from 'node:fs/promises';
import {
  createMxnCheckoutLedger, MXN_CHECKOUT_LEDGER_SCHEMA, normalizeMxnCheckoutLedgerEvent,
} from '../api/_lib/mxn-checkout-ledger.js';

const MAX_FILE_BYTES = 1_048_576;
const MAX_EVENTS = 500;

async function readEvents(path) {
  const file = await stat(path);
  if (!file.isFile() || file.size > MAX_FILE_BYTES) throw new Error('invalid_receipt_file');
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
  const events = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      normalizeMxnCheckoutLedgerEvent(event);
      events.push(event);
    } catch {
      throw new Error(`invalid_receipt_at_line_${index + 1}`);
    }
  }
  if (!events.length || events.length > MAX_EVENTS) throw new Error('invalid_receipt_count');
  return events;
}

async function importEvents(client, events) {
  const ledger = createMxnCheckoutLedger({ withTransaction: callback => callback(client) });
  const scopes = new Map();
  let recorded = 0;
  for (const input of events) {
    const result = await ledger.record(input);
    if (result.recorded) recorded += 1;
    const { environment, venue, kind, accountId } = result.event;
    const accountType = kind === 'builder_payout' ? 'builder' : 'user';
    scopes.set(JSON.stringify([environment, venue, accountType, accountId]),
      { environment, venue, accountType, accountId });
  }
  const totals = [];
  for (const scope of scopes.values()) totals.push({ ...scope, totals: await ledger.totals(scope) });
  return { recorded, replayed: events.length - recorded, totals };
}

async function preview(events) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    for (const statement of MXN_CHECKOUT_LEDGER_SCHEMA) await db.exec(statement);
    return await db.transaction(client => importEvents(client, events));
  } finally {
    await db.close();
  }
}

async function apply(events, connectionString) {
  const { Pool } = await import('@neondatabase/serverless');
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '15s'");
      const result = await importEvents(client, events);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function main(args) {
  if (args.length === 1 && args[0] === '--schema') {
    console.log(['BEGIN;', ...MXN_CHECKOUT_LEDGER_SCHEMA.map(sql => `${sql.trim().replace(/;$/, '')};`), 'COMMIT;'].join('\n'));
    return;
  }
  const commit = args[0] === '--apply';
  const path = args[commit ? 1 : 0];
  if (!path || path.startsWith('-') || args.length !== (commit ? 2 : 1)) {
    throw new Error('usage: node frontend/ops/mxn-checkout-ledger.mjs [--apply] receipts.jsonl | --schema');
  }
  const connectionString = process.env.MXN_LEDGER_DATABASE_URL;
  if (commit && !connectionString) throw new Error('MXN_LEDGER_DATABASE_URL is required for --apply');
  const events = await readEvents(path);
  const result = commit ? await apply(events, connectionString) : await preview(events);
  console.log(JSON.stringify({ dryRun: !commit, ...result }, null, 2));
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  const code = error?.code || error?.message;
  const safe = typeof code === 'string' && (/^[a-z0-9_]{1,80}$/i.test(code)
    || code.startsWith('usage:') || code === 'MXN_LEDGER_DATABASE_URL is required for --apply');
  console.error(safe ? code : 'ledger_import_failed');
  process.exitCode = 1;
}
