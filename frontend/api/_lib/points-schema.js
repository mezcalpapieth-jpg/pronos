/**
 * Points-app database schema.
 *
 * Everything under the `points_*` prefix is scoped to the off-chain
 * points-app (pronos.io/ root). It coexists in the same Neon database
 * as the MVP protocol_* tables but shares zero state with them — a
 * different user identity table, a different market table, a different
 * trades table.
 *
 * Design choices:
 * - `points_markets.reserves` is JSONB so the same schema handles binary
 *   (2-element array) and multi-outcome (N-element array) markets.
 * - `NUMERIC(30,18)` on share amounts gives us plenty of precision for
 *   fractional shares without the rounding problems of JS floats.
 * - `points_balances` is the single source of truth for current balance.
 *   Every mutation writes it AND an immutable `points_distributions` row
 *   so we can audit every credit/debit after the fact.
 * - `points_positions` is materialized for fast portfolio reads. It's
 *   updated in the same transaction as the trade that produced it.
 *
 * Self-heals on cold start (same pattern as protocol-schema.js and
 * user-schema.js). The boolean flag is per-instance.
 */

let pointsSchemaReady = false;

const POINTS_SCHEMA_MIGRATIONS = [
  // ── Users (Turnkey-backed identity, scoped to points app) ──────────────
  `CREATE TABLE IF NOT EXISTS points_users (
    id                   SERIAL PRIMARY KEY,
    turnkey_sub_org_id   TEXT UNIQUE NOT NULL,
    wallet_address       TEXT,
    username             TEXT UNIQUE,
    email                TEXT,
    created_at           TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_points_users_username_lower ON points_users (LOWER(username))`,
  `CREATE INDEX IF NOT EXISTS idx_points_users_wallet ON points_users(wallet_address)`,

  // ── Markets (off-chain, admin-curated) ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS points_markets (
    id              SERIAL PRIMARY KEY,
    question        TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'general',
    icon            TEXT,
    outcomes        JSONB NOT NULL,
    reserves        JSONB NOT NULL,
    seed_liquidity  NUMERIC(20,6) NOT NULL DEFAULT 500,
    end_time        TIMESTAMPTZ NOT NULL,
    resolution_src  TEXT,
    status          TEXT NOT NULL DEFAULT 'active',
    outcome         SMALLINT,
    created_by      TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    resolved_by     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_status ON points_markets(status)`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_end_time ON points_markets(end_time)`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_category ON points_markets(category)`,

  // ── Balances (single source of truth per user) ─────────────────────────
  `CREATE TABLE IF NOT EXISTS points_balances (
    username     TEXT PRIMARY KEY,
    balance      NUMERIC(20,6) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Trades (immutable log of every buy/sell) ───────────────────────────
  `CREATE TABLE IF NOT EXISTS points_trades (
    id              SERIAL PRIMARY KEY,
    market_id       INTEGER NOT NULL REFERENCES points_markets(id),
    username        TEXT NOT NULL,
    side            TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'redeem')),
    outcome_index   SMALLINT NOT NULL,
    shares          NUMERIC(30,18) NOT NULL,
    collateral      NUMERIC(20,6) NOT NULL,
    fee             NUMERIC(20,6) NOT NULL DEFAULT 0,
    price_at_trade  NUMERIC(10,6) NOT NULL,
    reserves_before JSONB,
    reserves_after  JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_trades_user ON points_trades(username)`,
  `CREATE INDEX IF NOT EXISTS idx_points_trades_market ON points_trades(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_points_trades_user_market ON points_trades(username, market_id)`,

  // ── Positions (materialized — updated atomically with each trade) ──────
  `CREATE TABLE IF NOT EXISTS points_positions (
    market_id       INTEGER NOT NULL REFERENCES points_markets(id),
    username        TEXT NOT NULL,
    outcome_index   SMALLINT NOT NULL,
    shares          NUMERIC(30,18) NOT NULL DEFAULT 0,
    cost_basis      NUMERIC(20,6) NOT NULL DEFAULT 0,
    realized_pnl    NUMERIC(20,6) NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (market_id, username, outcome_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_positions_user ON points_positions(username)`,

  // ── Daily claim tracking (prevents double-claim per day) ───────────────
  `CREATE TABLE IF NOT EXISTS daily_claims (
    username      TEXT NOT NULL,
    claim_date    DATE NOT NULL,
    amount        NUMERIC(20,6) NOT NULL,
    streak_day    INTEGER NOT NULL,
    claimed_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (username, claim_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_claims_user ON daily_claims(username, claim_date DESC)`,

  // ── Streaks (current + best per user) ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS points_streaks (
    username        TEXT PRIMARY KEY,
    current_streak  INTEGER NOT NULL DEFAULT 0,
    last_claim_date DATE,
    best_streak     INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ── Distributions (immutable audit log of every balance change) ────────
  // Signed amount: positive = credit, negative = debit.
  // `kind` enumerates the reason so we can filter reports by category.
  `CREATE TABLE IF NOT EXISTS points_distributions (
    id             SERIAL PRIMARY KEY,
    username       TEXT NOT NULL,
    amount         NUMERIC(20,6) NOT NULL,
    kind           TEXT NOT NULL,
    reference_id   INTEGER,
    reason         TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_distributions_user ON points_distributions(username, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_points_distributions_kind ON points_distributions(kind, created_at DESC)`,

  // ── Referrals (track referrer/referred pairs; reward on first trade) ──
  `CREATE TABLE IF NOT EXISTS points_referrals (
    id             SERIAL PRIMARY KEY,
    referrer       TEXT NOT NULL,
    referred       TEXT UNIQUE NOT NULL,
    rewarded       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    rewarded_at    TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_referrals_referrer ON points_referrals(referrer)`,

  // ── Social tasks (admin-verified claims: IG/TikTok/X follows, likes…) ─
  `CREATE TABLE IF NOT EXISTS social_tasks (
    id             SERIAL PRIMARY KEY,
    username       TEXT NOT NULL,
    task_key       TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    reward         NUMERIC(20,6) NOT NULL DEFAULT 0,
    proof_url      TEXT,
    reviewer       TEXT,
    reviewed_at    TIMESTAMPTZ,
    rejection_note TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, task_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_social_tasks_status ON social_tasks(status, created_at DESC)`,

  // ── Price history snapshots (one row per market per hour) ──────────────
  // Built by /api/cron/points-snapshot-prices. Lets the UI render a
  // sparkline per market without having to replay every trade. Prices
  // and reserves are stored as JSONB arrays so multi-outcome markets fit
  // the same shape.
  `CREATE TABLE IF NOT EXISTS points_price_snapshots (
    id            SERIAL PRIMARY KEY,
    market_id     INTEGER NOT NULL REFERENCES points_markets(id) ON DELETE CASCADE,
    prices        JSONB NOT NULL,
    reserves      JSONB NOT NULL,
    snapshotted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_price_snapshots_market_time
    ON points_price_snapshots(market_id, snapshotted_at DESC)`,

  // ── Competition cycles (2-week leaderboard periods) ────────────────────
  // One active cycle at a time. Admin can close a cycle (snapshots the
  // leaderboard into points_cycle_snapshots) and automatically opens the
  // next 2-week window. Closed cycles stay queryable for historical
  // winners pages.
  `CREATE TABLE IF NOT EXISTS points_cycles (
    id            SERIAL PRIMARY KEY,
    label         TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at       TIMESTAMPTZ NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    closed_at     TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_cycles_status ON points_cycles(status, ends_at DESC)`,

  // ── Cycle leaderboard snapshots (immutable after rollover) ─────────────
  `CREATE TABLE IF NOT EXISTS points_cycle_snapshots (
    id             SERIAL PRIMARY KEY,
    cycle_id       INTEGER NOT NULL REFERENCES points_cycles(id) ON DELETE CASCADE,
    username       TEXT NOT NULL,
    final_balance  NUMERIC(20,6) NOT NULL,
    final_pnl      NUMERIC(20,6) NOT NULL DEFAULT 0,
    rank           INTEGER NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(cycle_id, username)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_cycle_snapshots_cycle_rank
    ON points_cycle_snapshots(cycle_id, rank ASC)`,
];

export async function ensurePointsSchema(sql) {
  if (pointsSchemaReady) return;
  for (const migration of POINTS_SCHEMA_MIGRATIONS) {
    await sql.query(migration);
  }
  pointsSchemaReady = true;
}

/**
 * Postgres error detector: a missing-table error leaks from the neon
 * serverless driver as `{ code: '42P01' }`. Keep the detection narrow
 * so we don't accidentally swallow real errors.
 */
export function isPointsSchemaError(error) {
  if (!error) return false;
  if (error.code === '42P01') return true;
  const msg = error.message || '';
  return /relation "points_[a-z_]+" does not exist/i.test(msg)
      || /relation "daily_claims" does not exist/i.test(msg)
      || /relation "social_tasks" does not exist/i.test(msg);
}

export function formatPointsSchemaError(prefix, error) {
  return {
    prefix,
    message: error?.message,
    code: error?.code,
    detail: error?.detail,
  };
}
