import { neon } from '@neondatabase/serverless';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { ensureStockSchema, STOCK_SCHEMA_MIGRATIONS } from '../_lib/stock-schema.js';
import { withTransaction } from '../_lib/db-tx.js';

const expectedHost = process.argv.find(arg => arg.startsWith('--expected-host='))?.slice('--expected-host='.length);
if (!expectedHost || new URL(process.env.DATABASE_URL).hostname !== expectedHost) throw new Error('Pass --expected-host matching the reviewed database target.');
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ databaseHost: expectedHost, schemaVersion: 3, statements: STOCK_SCHEMA_MIGRATIONS, applied: false }, null, 2));
} else {
  const sql = neon(process.env.DATABASE_URL);
  await ensurePointsSchema(sql);
  await ensureStockSchema(withTransaction);
  console.log(JSON.stringify({ databaseHost: expectedHost, schemaVersion: 3, applied: true }));
}
process.exit(0);
