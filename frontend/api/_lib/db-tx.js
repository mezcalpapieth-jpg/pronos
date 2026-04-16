/**
 * Multi-statement transaction helper for the points app.
 *
 * Why this exists:
 *   The `neon()` HTTP client is stateless — each query is a fresh HTTP
 *   request. BEGIN/COMMIT/ROLLBACK do nothing across separate calls
 *   because there's no persistent session. Our trading endpoints
 *   (buy/sell/redeem/claim-daily/username) need real transactions
 *   because they read current state, validate, then write derived state
 *   atomically.
 *
 *   This helper uses `@neondatabase/serverless`'s Pool (a pg-compatible
 *   WebSocket connection) which DOES support interactive transactions.
 *   One WS connection per invocation, opened on demand, released after.
 *
 * Usage:
 *
 *   import { withTransaction } from '../_lib/db-tx.js';
 *
 *   const result = await withTransaction(async (client) => {
 *     const { rows } = await client.query(
 *       'SELECT balance FROM points_balances WHERE username = $1 FOR UPDATE',
 *       [username]
 *     );
 *     if (rows[0].balance < amount) throw new Error('insufficient');
 *     await client.query('UPDATE points_balances SET balance = balance - $1 WHERE username = $2', [amount, username]);
 *     return { newBalance: rows[0].balance - amount };
 *   });
 *
 * The client is auto-released whether the handler succeeds or throws.
 * ROLLBACK runs on any thrown error; COMMIT runs on successful return.
 */

import { Pool, neonConfig } from '@neondatabase/serverless';

// Required once per process to enable WebSocket transport in Vercel's
// Node runtime. Without this the Pool throws at connect time.
// `ws` is pre-installed in the Neon driver.
let wsConfigured = false;
async function ensureWebSocket() {
  if (wsConfigured) return;
  wsConfigured = true;
  // Only pull in the `ws` module when we actually need it (keeps cold
  // starts fast for HTTP-only endpoints).
  const ws = await import('ws');
  neonConfig.webSocketConstructor = ws.default ?? ws.WebSocket ?? ws;
}

let pool = null;
function getPool() {
  if (pool) return pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) {
    throw new Error('db-tx: DATABASE_URL not configured');
  }
  pool = new Pool({ connectionString: cs, max: 3 });
  return pool;
}

export async function withTransaction(handler) {
  await ensureWebSocket();
  const client = await getPool().connect();
  let committed = false;
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    committed = true;
    return result;
  } catch (error) {
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // If ROLLBACK itself fails the connection is poisoned — log and
        // release; next checkout gets a fresh one from the pool.
        console.error('[db-tx] rollback failed', { message: rollbackErr?.message });
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Narrow helper used by write endpoints that do a single INSERT/UPDATE
 * and don't need a transaction. Routes through the Pool too so the pg
 * parameter-placeholder syntax (`$1`, `$2`…) stays consistent with
 * withTransaction code paths. Prefer the neon() HTTP client for simple
 * reads that don't need session state — it's faster.
 */
export async function poolQuery(text, params = []) {
  await ensureWebSocket();
  const client = await getPool().connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}
