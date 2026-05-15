let protocolSchemaReady = false;

const PROTOCOL_SCHEMA_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS protocol_markets (
    id              SERIAL PRIMARY KEY,
    chain_id        INTEGER NOT NULL DEFAULT 42161,
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
  `CREATE TABLE IF NOT EXISTS price_snapshots (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES protocol_markets(id),
    yes_price       NUMERIC(10,6) NOT NULL,
    no_price        NUMERIC(10,6) NOT NULL,
    volume_24h      NUMERIC(20,6) DEFAULT 0,
    liquidity       NUMERIC(20,6) DEFAULT 0,
    snapshot_at     TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS protocol_version TEXT NOT NULL DEFAULT 'v1'`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS outcome_count INTEGER NOT NULL DEFAULT 2`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS outcomes JSONB`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS icon TEXT`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS sport TEXT`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS league TEXT`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS outcome_images JSONB`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS category_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS geo_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS topic_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS source_event_id TEXT`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS resolver_type TEXT`,
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS resolver_config JSONB`,
  `CREATE INDEX IF NOT EXISTS idx_protocol_markets_category_tags ON protocol_markets USING GIN (category_tags)`,
  `CREATE INDEX IF NOT EXISTS idx_protocol_markets_geo_tags ON protocol_markets USING GIN (geo_tags)`,
  `CREATE INDEX IF NOT EXISTS idx_protocol_markets_topic_tags ON protocol_markets USING GIN (topic_tags)`,
  // start_time mirrors the points_markets column — kickoff for sports
  // markets, NULL for everything else. The on-chain factory.createMarket
  // doesn't take a start_time; admin sets it via the create-market
  // endpoint and we INSERT the value into the row before the indexer
  // first sees the MarketCreated event (the indexer's UPSERT preserves
  // any non-null start_time on conflict). Used by /api/protocol/markets
  // to put live markets at the front of the grid.
  `ALTER TABLE protocol_markets ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ`,
  `UPDATE protocol_markets SET factory_address = LOWER(factory_address), pool_address = LOWER(pool_address)`,
  `ALTER TABLE protocol_markets DROP CONSTRAINT IF EXISTS protocol_markets_chain_id_market_id_key`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_protocol_markets_chain_factory_market ON protocol_markets(chain_id, factory_address, market_id)`,
  `ALTER TABLE trades ADD COLUMN IF NOT EXISTS outcome_index SMALLINT`,
  `ALTER TABLE trades ALTER COLUMN is_yes DROP NOT NULL`,
  `ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS prices JSONB`,
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
  `CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address)`,
  `CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outcome_positions_user ON outcome_positions(user_address)`,
  `CREATE INDEX IF NOT EXISTS idx_outcome_positions_market ON outcome_positions(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_market ON price_snapshots(market_id, snapshot_at)`,
  `CREATE INDEX IF NOT EXISTS idx_markets_status ON protocol_markets(status)`,
  // ── Redemptions table: on-chain WinningsRedeemed events ────────────────
  // Lets us show an authoritative payout in the Portfolio history instead
  // of estimating from winning-share count.
  `CREATE TABLE IF NOT EXISTS redemptions (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES protocol_markets(id),
    user_address    TEXT NOT NULL,
    outcome_index   SMALLINT,
    shares          NUMERIC(20,6) NOT NULL,
    payout          NUMERIC(20,6) NOT NULL,
    tx_hash         TEXT NOT NULL,
    block_number    BIGINT NOT NULL,
    log_index       INTEGER NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tx_hash, log_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_redemptions_user ON redemptions(user_address)`,
  `CREATE INDEX IF NOT EXISTS idx_redemptions_market ON redemptions(market_id)`,
];

export async function ensureProtocolSchema(sql) {
  if (protocolSchemaReady) return;
  for (const migration of PROTOCOL_SCHEMA_MIGRATIONS) {
    await sql.query(migration);
  }
  protocolSchemaReady = true;
}
