export const STOCK_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS points_stock_cache (
    cache_key TEXT PRIMARY KEY, payload JSONB NOT NULL, fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS points_stock_positions (
    username TEXT NOT NULL, cycle_id INTEGER NOT NULL REFERENCES points_cycles(id),
    ticker TEXT NOT NULL, quantity NUMERIC(30,18) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    cost_basis NUMERIC(20,6) NOT NULL DEFAULT 0 CHECK (cost_basis >= 0),
    realized_pnl NUMERIC(20,6) NOT NULL DEFAULT 0,
    current_value NUMERIC(20,6), mark_price_usd NUMERIC(24,8), marked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (username, cycle_id, ticker)
  )`,
  `CREATE TABLE IF NOT EXISTS points_stock_quotes (
    id UUID PRIMARY KEY, username TEXT NOT NULL, cycle_id INTEGER NOT NULL REFERENCES points_cycles(id),
    ticker TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy','sell')),
    request JSONB NOT NULL, payload JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_quotes_expiry ON points_stock_quotes(expires_at)`,
  `CREATE TABLE IF NOT EXISTS points_stock_trades (
    id SERIAL PRIMARY KEY, username TEXT NOT NULL, cycle_id INTEGER NOT NULL REFERENCES points_cycles(id),
    ticker TEXT NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy','sell')),
    quote_id UUID NOT NULL UNIQUE REFERENCES points_stock_quotes(id),
    quantity NUMERIC(30,18) NOT NULL CHECK (quantity > 0),
    price_usd NUMERIC(24,8) NOT NULL, fx_rate NUMERIC(24,8) NOT NULL,
    fx_date TEXT NOT NULL, gross NUMERIC(20,6) NOT NULL, fee NUMERIC(20,6) NOT NULL,
    total NUMERIC(20,6) NOT NULL, realized_pnl NUMERIC(20,6) NOT NULL,
    idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, result JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (username, idempotency_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_trades_user_cycle ON points_stock_trades(username, cycle_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS points_stock_valuations (
    username TEXT NOT NULL, cycle_id INTEGER NOT NULL REFERENCES points_cycles(id),
    sampled_at TIMESTAMPTZ NOT NULL, current_value NUMERIC(20,6) NOT NULL,
    cost_basis NUMERIC(20,6) NOT NULL, realized_pnl NUMERIC(20,6) NOT NULL,
    PRIMARY KEY (username, cycle_id, sampled_at)
  )`,
];

let ready = false;
// Stock DDL runs only through enabled stock routes, on one real transaction.
export async function ensureStockSchema(transaction) {
  if (ready) return;
  await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('points_stock_schema_v1'))");
    for (const statement of STOCK_SCHEMA_MIGRATIONS) await client.query(statement);
  });
  ready = true;
}
