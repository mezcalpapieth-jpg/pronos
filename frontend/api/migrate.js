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

  // V2 multi-outcome protocol compatibility. V1 rows keep defaults.
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT 'v1'`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS outcome_count INTEGER NOT NULL DEFAULT 2`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS outcomes JSONB`,
  `UPDATE protocol_markets SET factory_address = LOWER(factory_address), pool_address = LOWER(pool_address)`,
  `ALTER TABLE protocol_markets DROP CONSTRAINT IF EXISTS protocol_markets_chain_id_market_id_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_protocol_markets_chain_factory_market ON protocol_markets(chain_id, factory_address, market_id)`,
  `ALTER TABLE trades ADD COLUMN IF NOT EXISTS outcome_index SMALLINT`,
  `ALTER TABLE trades ALTER COLUMN is_yes DROP NOT NULL`,
  `ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS prices JSONB`,

  // V2 positions, one row per outcome held by a user.
  `CREATE TABLE IF NOT EXISTS outcome_positions (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES protocol_markets(id),
    user_address    TEXT NOT NULL,
    outcome_index   SMALLINT NOT NULL,
    shares          NUMERIC(20,6) DEFAULT 0,
    total_cost      NUMERIC(20,6) DEFAULT 0,
    redeemed        BOOLEAN DEFAULT FALSE,
    payout          NUMERIC(20,6) DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(market_id, user_address, outcome_index)
  )`,

  // Index for fast queries
  `CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outcome_positions_user ON outcome_positions(user_address)`,
  `CREATE INDEX IF NOT EXISTS idx_outcome_positions_market ON outcome_positions(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_market ON price_snapshots(market_id, snapshot_at)`,
  `CREATE INDEX IF NOT EXISTS idx_markets_status ON protocol_markets(status)`,

  // Indexer state (tracks last processed block per chain)
  `CREATE TABLE IF NOT EXISTS indexer_state (
    chain_id        INTEGER PRIMARY KEY,
    last_block      BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS indexer_factory_state (
    chain_id        INTEGER NOT NULL,
    factory_address TEXT NOT NULL,
    last_block      BIGINT NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (chain_id, factory_address)
  )`,

  // Market resolutions (admin-driven, works before on-chain contracts)
  `CREATE TABLE IF NOT EXISTS market_resolutions (
    id              SERIAL PRIMARY KEY,
    market_id       TEXT NOT NULL UNIQUE,
    outcome         TEXT NOT NULL,
    winner          TEXT NOT NULL,
    winner_short    TEXT,
    resolved_by     TEXT,
    description     TEXT,
    resolved_at     TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resolutions_market ON market_resolutions(market_id)`,

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

  // AI-generated markets (daily pipeline)
  // status: pending | approved | rejected | live
  `CREATE TABLE IF NOT EXISTS generated_markets (
    id              SERIAL PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    category        TEXT NOT NULL,
    category_label  TEXT,
    icon            TEXT,
    deadline        TEXT,
    deadline_date   DATE,
    options         JSONB NOT NULL,
    volume          TEXT,
    region          TEXT,
    reasoning       TEXT,
    source_headlines JSONB,
    model           TEXT,
    raw_response    JSONB,
    status          TEXT NOT NULL DEFAULT 'pending',
    generated_at    TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ,
    reviewed_by     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_gen_markets_status ON generated_markets(status)`,
  `CREATE INDEX IF NOT EXISTS idx_gen_markets_region ON generated_markets(region)`,

  // Polymarket approval allow-list. Live markets fetched from Gamma do NOT
  // appear on the public site unless an admin has approved their slug here.
  // Translation cache: title_es / options_es store the Spanish version
  // cached at approval/import time so the public site can render in Spanish
  // without re-translating on every request.
  `CREATE TABLE IF NOT EXISTS polymarket_approved (
    slug          TEXT PRIMARY KEY,
    title_es      TEXT,
    options_es    JSONB,
    approved_at   TIMESTAMPTZ DEFAULT NOW(),
    approved_by   TEXT,
    status        TEXT NOT NULL DEFAULT 'approved'
  )`,
  // Status column was added in a follow-up; ensure it exists for installs
  // that already created the table without it.
  `ALTER TABLE polymarket_approved ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'`,
  `CREATE INDEX IF NOT EXISTS idx_polymarket_approved_at ON polymarket_approved(approved_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_polymarket_approved_status ON polymarket_approved(status)`,

  // Case-insensitive usernames: normalize existing rows and enforce uniqueness on LOWER(username)
  `UPDATE users SET username = LOWER(username) WHERE username IS NOT NULL AND username <> LOWER(username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username))`,
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
      await sql.query(migration);
      results.push({ sql: migration.slice(0, 60) + '…', ok: true });
    } catch (e) {
      results.push({ sql: migration.slice(0, 60) + '…', ok: false, error: e.message });
    }
  }

  return res.status(200).json({ results });
}
