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
  // Turnkey delegated-signing policy (M2). When non-null, the Pronos
  // backend API key can sign on-chain trades on this user's behalf
  // within the policy's scope — up to `delegation_daily_cap_mxnb`
  // per 24h against whitelisted contracts, valid until
  // `delegation_expires_at`. Withdrawals + policy changes still
  // require fresh user signature.
  `ALTER TABLE points_users ADD COLUMN IF NOT EXISTS delegation_policy_id TEXT`,
  `ALTER TABLE points_users ADD COLUMN IF NOT EXISTS delegation_expires_at TIMESTAMPTZ`,
  `ALTER TABLE points_users ADD COLUMN IF NOT EXISTS delegation_daily_cap_mxnb NUMERIC(20,6)`,
  `ALTER TABLE points_users ADD COLUMN IF NOT EXISTS delegation_authorized_at TIMESTAMPTZ`,

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
  // Chain classifier (M3). `mode` is one of:
  //   'points'  — DB-backed CPMM (what every market currently uses)
  //   'onchain' — settled via PronosAMM contracts on Arbitrum; the
  //               DB row mirrors on-chain state via the indexer and
  //               carries chain_market_id (factory's numeric id) +
  //               chain_address (the pool contract).
  //
  // Default 'points' keeps existing code paths untouched. When M4
  // introduces the dual buy/sell dispatch, rows with mode='onchain'
  // route through the Turnkey delegation + paymaster path; everyone
  // else keeps the row-lock + atomic txn path.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'points'`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS chain_id INTEGER`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS chain_market_id BIGINT`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS chain_address TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_mode ON points_markets(mode) WHERE mode <> 'points'`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_category ON points_markets(category)`,

  // amm_mode: 'unified' (default — one pool, N-outcome CPMM) or 'parallel'
  // (Polymarket-style: each outcome is its own binary market, grouped under
  // a parent row). parent_id links legs to their parent; leg_label stores
  // the per-leg display label ("57°F or below", "58-59°F", …). Only legs
  // set parent_id; parents and unified markets leave it NULL.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS amm_mode TEXT NOT NULL DEFAULT 'unified'`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES points_markets(id)`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS leg_label TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_parent ON points_markets(parent_id)`,

  // start_time: for sports markets, kickoff. Trading stays open through
  // the game and end_time sits a sport-specific padding past kickoff
  // (so we auto-close after the game wraps, not before it starts).
  // NULL for non-sports markets where there's no distinct "start" vs
  // "settle" distinction (crypto/FX over-unders, weather, charts).
  // Used by the UI to show a LIVE badge while start_time <= now < end_time.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ`,

  // sport/league: cheap, generator-set classifiers for the per-type
  // pages. `sport` is one of {'mlb','nba','soccer','f1',…} — drives the
  // sports sub-filter. `league` narrows within a sport (soccer →
  // 'premier-league' / 'la-liga' / 'uefa-cl' / etc.; 'mlb' → 'mlb'; 'nba'
  // → 'nba'). Both nullable so existing markets and non-sports markets
  // just stay unclassified (they still show in the parent category).
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS sport TEXT`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS league TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_sport ON points_markets(sport)`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_league ON points_markets(league)`,
  // One-shot: earlier MLB generator emitted sport='mlb', but the
  // UI sub-filter keys on sport='baseball' with the MLB/LMB split
  // carried by `league`. Collapse 'mlb' into 'baseball' so existing
  // markets show up under the Béisbol tab.
  `UPDATE points_markets SET sport = 'baseball', league = COALESCE(league, 'mlb') WHERE sport = 'mlb'`,

  // outcome_images: JSONB array index-aligned with `outcomes`. Each slot
  // is either a URL string (team crest / player portrait) or null when
  // the outcome has no associated image (e.g. 'Empate' for 3-way soccer,
  // or the 'Otro' leg on F1). Populated by the sports generators; null
  // for every other market type (crypto / weather / charts).
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS outcome_images JSONB`,

  // featured: when true, the market appears in the home "Trending"
  // grid in addition to its own category page. When false, it only
  // surfaces under /c/<category>. Defaults TRUE so existing markets
  // keep showing up on home; admin can toggle specific markets off
  // via the 🔥 button in the approved-markets list.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT true`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_featured_status
    ON points_markets(featured, status) WHERE featured = true`,

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
  // dismissed_at: timestamp the user hit "OK" on a losing resolved
  // position to acknowledge the loss and clear it from the Active
  // tab. Trades are immutable so Historial still shows the full
  // record; this just hides the line from the open-positions view.
  `ALTER TABLE points_positions ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ`,

  // ── Social account links (OAuth-verified) ────────────────────────────────
  // Separate from `social_tasks` (admin-reviewed proofs). When a user
  // completes an OAuth flow to X / Instagram / TikTok, we store the
  // verified provider handle + user id here. Two UNIQUEs matter:
  //   (username, provider)      — one account per provider per user
  //   (provider, provider_user_id) — a given social account can only
  //                                  link to one Pronos user (prevents
  //                                  farming rewards across accounts)
  `CREATE TABLE IF NOT EXISTS points_social_links (
    id                SERIAL PRIMARY KEY,
    username          TEXT NOT NULL,
    provider          TEXT NOT NULL,
    provider_user_id  TEXT NOT NULL,
    handle            TEXT,
    profile_url       TEXT,
    reward_credited   BOOLEAN NOT NULL DEFAULT false,
    linked_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (username, provider),
    UNIQUE (provider, provider_user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_social_links_user ON points_social_links(username)`,

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

  // ── Comments (per-market discussion, soft-deleted) ────────────────────────
  // Keyed on market_id. `deleted_at` = NULL means live; non-null means hidden
  // from the feed. We keep soft-deletes so admin can audit / un-delete later
  // without reverting from a backup.
  `CREATE TABLE IF NOT EXISTS points_comments (
    id           SERIAL PRIMARY KEY,
    market_id    INTEGER NOT NULL REFERENCES points_markets(id) ON DELETE CASCADE,
    username     TEXT NOT NULL,
    body         TEXT NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_comments_market
    ON points_comments(market_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_points_comments_user
    ON points_comments(username, created_at DESC)`,

  // ── Resolver metadata on points_markets ───────────────────────────────────
  // resolver_type  = 'manual' (default, admin resolves) | 'chainlink_price'
  //                  (auto-settle via a Chainlink price feed at close) |
  //                  'sports_api' (auto-settle from the generator's source).
  // resolver_config = opaque JSONB that varies per resolver. For
  //   chainlink_price: { feedId, feedAddress, chainId, threshold, op: 'gt'|'lt'|'gte'|'lte' }
  //   sports_api: { source: 'football-data.org', matchId, scorePath }
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS resolver_type TEXT`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS resolver_config JSONB`,

  // ── Pending markets (agent-generated, awaiting admin approval) ────────────
  // The daily generator cron writes one row here per discovered event. The
  // admin queue UI reads live rows; approving copies the spec into
  // points_markets (+resolver_type/resolver_config) and marks the row
  // 'approved'. Rejecting marks 'rejected'. A UNIQUE index on (source,
  // source_event_id) keeps re-runs idempotent — re-generating the same
  // match tomorrow is a no-op, so the queue doesn't fill up.
  `CREATE TABLE IF NOT EXISTS points_pending_markets (
    id                SERIAL PRIMARY KEY,
    source            TEXT NOT NULL,
    source_event_id   TEXT NOT NULL,
    source_data       JSONB,
    question          TEXT NOT NULL,
    category          TEXT NOT NULL,
    icon              TEXT,
    outcomes          JSONB NOT NULL,
    seed_liquidity    NUMERIC(20,6) NOT NULL DEFAULT 1000,
    end_time          TIMESTAMPTZ NOT NULL,
    amm_mode          TEXT NOT NULL DEFAULT 'unified',
    resolver_type     TEXT,
    resolver_config   JSONB,
    status            TEXT NOT NULL DEFAULT 'pending',
    admin_note        TEXT,
    reviewer          TEXT,
    reviewed_at       TIMESTAMPTZ,
    approved_market_id INTEGER REFERENCES points_markets(id),
    created_at        TIMESTAMPTZ DEFAULT NOW()
  )`,
  // start_time on pending rows mirrors the one on points_markets — see
  // comment above. The approve path carries it across unchanged.
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ`,
  // sport/league mirror the columns on points_markets so the approve
  // path can pass them through verbatim.
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS sport TEXT`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS league TEXT`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS outcome_images JSONB`,
  // featured mirrors the final column on points_markets so admin can
  // pre-set "show in Trending?" from the pending queue before approval.
  // Default false on pending — admin explicitly ticks the 🔥 to feature.
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT false`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_points_pending_source_event
    ON points_pending_markets(source, source_event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_points_pending_status
    ON points_pending_markets(status, end_time ASC)`,
];

// PostgreSQL error codes we treat as idempotent no-ops during migration.
// `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` are racy:
// two concurrent requests can both pass the existence check and one
// ends up throwing 42P07 / 42710 / etc. even though the end state is
// correct. Swallowing these codes makes the migration safe under
// concurrent cold starts (common on Vercel serverless, where a burst
// of requests can spin up multiple Lambdas simultaneously).
const IDEMPOTENT_ERROR_CODES = new Set([
  '42P06', // duplicate_schema
  '42P07', // duplicate_table
  '42710', // duplicate_object (index, constraint, trigger)
  '42701', // duplicate_column
  '42P16', // invalid_table_definition (seen when column already exists)
]);

function isIdempotentError(err) {
  if (!err) return false;
  if (IDEMPOTENT_ERROR_CODES.has(err.code)) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('already exists');
}

export async function ensurePointsSchema(sql) {
  if (pointsSchemaReady) return;
  for (const migration of POINTS_SCHEMA_MIGRATIONS) {
    try {
      await sql.query(migration);
    } catch (err) {
      if (isIdempotentError(err)) {
        // Another concurrent cold-start already created this object —
        // end state is correct, keep going.
        continue;
      }
      throw err;
    }
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
