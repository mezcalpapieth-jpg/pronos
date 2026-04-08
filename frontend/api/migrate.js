import { neon } from '@neondatabase/serverless';

/**
 * Database migration for Pronos own protocol.
 * Run once via: GET /api/migrate?key=<MIGRATE_KEY>
 *
 * Creates tables for markets, trades, positions, and price snapshots.
 * Existing tables (users) are untouched.
 */

const sql = neon(process.env.DATABASE_URL);

const MIGRATIONS = [
  // Own protocol markets
  `CREATE TABLE IF NOT EXISTS protocol_markets (
    id              SERIAL PRIMARY KEY,
    chain_id        INTEGER NOT NULL DEFAULT 421614,
    factory_address TEXT NOT NULL,
    pool_address    TEXT NOT NULL,
    market_id       INTEGER NOT NULL,
    question        TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general',
    end_time        TIMESTAMPTZ NOT NULL,
    resolution_src  TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    outcome         SMALLINT DEFAULT 0,
    seed_liquidity  NUMERIC(20,6) DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    tx_hash         TEXT,
    UNIQUE(chain_id, market_id)
  )`,

  // Trades (buys and sells)
  `CREATE TABLE IF NOT EXISTS trades (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES protocol_markets(id),
    trader          TEXT NOT NULL,
    side            TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    is_yes          BOOLEAN NOT NULL,
    collateral_amt  NUMERIC(20,6) NOT NULL,
    shares_amt      NUMERIC(20,6) NOT NULL,
    fee_amt         NUMERIC(20,6) DEFAULT 0,
    price_at_trade  NUMERIC(10,6),
    tx_hash         TEXT NOT NULL,
    block_number    BIGINT NOT NULL,
    log_index       INTEGER NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tx_hash, log_index)
  )`,

  // User positions (materialized from trades)
  `CREATE TABLE IF NOT EXISTS positions (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES protocol_markets(id),
    user_address    TEXT NOT NULL,
    yes_shares      NUMERIC(20,6) DEFAULT 0,
    no_shares       NUMERIC(20,6) DEFAULT 0,
    total_cost      NUMERIC(20,6) DEFAULT 0,
    redeemed        BOOLEAN DEFAULT FALSE,
    payout          NUMERIC(20,6) DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(market_id, user_address)
  )`,

  // Price snapshots (for charts)
  `CREATE TABLE IF NOT EXISTS price_snapshots (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES protocol_markets(id),
    yes_price       NUMERIC(10,6) NOT NULL,
    no_price        NUMERIC(10,6) NOT NULL,
    volume_24h      NUMERIC(20,6) DEFAULT 0,
    liquidity       NUMERIC(20,6) DEFAULT 0,
    snapshot_at     TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Index for fast queries
  `CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_market ON price_snapshots(market_id, snapshot_at)`,
  `CREATE INDEX IF NOT EXISTS idx_markets_status ON protocol_markets(status)`,

  // Indexer state (tracks last processed block per chain)
  `CREATE TABLE IF NOT EXISTS indexer_state (
    chain_id        INTEGER PRIMARY KEY,
    last_block      BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,

  // Waitlist signups
  `CREATE TABLE IF NOT EXISTS waitlist (
    id              SERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    name            TEXT,
    source          TEXT DEFAULT 'landing',
    email_sent      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email)`,
];

export default async function handler(req, res) {
  // Simple auth to prevent accidental runs
  const key = req.query.key;
  if (key !== process.env.MIGRATE_KEY) {
    return res.status(403).json({ error: 'Invalid key' });
  }

  const results = [];
  for (const migration of MIGRATIONS) {
    try {
      await sql(migration);
      results.push({ sql: migration.slice(0, 60) + '…', ok: true });
    } catch (e) {
      results.push({ sql: migration.slice(0, 60) + '…', ok: false, error: e.message });
    }
  }

  return res.status(200).json({ results });
}
