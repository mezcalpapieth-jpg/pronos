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
let pointsSchemaProbeReady = false;

const POINTS_SCHEMA_LOCK_LEASE_SECONDS = 45;

const POINTS_SCHEMA_READY_PROBE = `
  SELECT
    to_regclass('public.points_users') IS NOT NULL AS points_users,
    to_regclass('public.points_markets') IS NOT NULL AS points_markets,
    to_regclass('public.points_balances') IS NOT NULL AS points_balances,
    to_regclass('public.points_trades') IS NOT NULL AS points_trades,
    to_regclass('public.points_positions') IS NOT NULL AS points_positions,
    to_regclass('public.points_limit_orders') IS NOT NULL AS points_limit_orders,
    to_regclass('public.points_site_time_daily') IS NOT NULL AS points_site_time_daily,
    to_regclass('public.points_publicity_daily') IS NOT NULL AS points_publicity_daily,
    to_regclass('public.points_resolution_candidates') IS NOT NULL AS points_resolution_candidates,
    to_regclass('public.points_support_tickets') IS NOT NULL AS points_support_tickets,
    to_regclass('public.points_support_messages') IS NOT NULL AS points_support_messages,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'points_markets'
        AND column_name = 'seed_liquidities'
    ) AS points_markets_seed_liquidities,
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'points_pending_markets'
        AND column_name = 'seed_liquidities'
    ) AS points_pending_seed_liquidities
`;

const POINTS_SCHEMA_LOCK_TABLE = `
  CREATE TABLE IF NOT EXISTS points_schema_locks (
    name          TEXT PRIMARY KEY,
    locked_until  TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

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
  `CREATE INDEX IF NOT EXISTS idx_points_users_created_at
    ON points_users(created_at DESC)`,
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
  // seed_liquidities is index-aligned with outcomes and lets admin seed
  // asymmetric AMMs (e.g. favorites get deeper starting liquidity). The
  // older scalar seed_liquidity stays as a fallback/default for legacy rows.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS seed_liquidities JSONB`,
  // category_tags let one market live in multiple browse/admin buckets.
  // Example: a Liga MX match is primarily category='deportes', but also
  // carries category_tags=['deportes','mexico'] so it appears under
  // Mexico & Latam. geo_tags split Mexico vs Latam inside that bucket,
  // and topic_tags power subfilters such as weather / sports / crypto.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS category_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS geo_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS topic_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_category_tags ON points_markets USING GIN (category_tags)`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_geo_tags ON points_markets USING GIN (geo_tags)`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_topic_tags ON points_markets USING GIN (topic_tags)`,
  `UPDATE points_markets
     SET category_tags = CASE
       WHEN category IN ('crypto', 'world-cup') THEN to_jsonb(ARRAY[category])
       WHEN category = 'deportes' AND (
         league IN ('liga-mx', 'lmb')
         OR question ~* '(cruz azul|chivas|guadalajara|america|américa|pumas|tigres|rayados|monterrey|liga mx|diablos rojos|lmb)'
       ) THEN '["deportes","mexico"]'::jsonb
       WHEN category <> 'mexico' AND question ~* '(mexico|méxico|cdmx|latam|latinoamérica|latinoamerica|américa latina|america latina|argentina|brasil|brazil|colombia|chile|peru|uruguay|peso mexicano|mxn|pemex|aeromexico|volaris)'
         THEN to_jsonb(ARRAY[COALESCE(NULLIF(category, ''), 'general'), 'mexico'])
       ELSE to_jsonb(ARRAY[COALESCE(NULLIF(category, ''), 'general')])
     END
   WHERE category_tags IS NULL OR category_tags = '[]'::jsonb`,
  `UPDATE points_markets
     SET geo_tags = CASE
       WHEN category IN ('crypto', 'world-cup') THEN '[]'::jsonb
       WHEN category = 'mexico'
         OR league IN ('liga-mx', 'lmb')
         OR question ~* '(mexico|méxico|cdmx|cruz azul|chivas|guadalajara|america|américa|pumas|tigres|rayados|monterrey|liga mx|diablos rojos|lmb|peso mexicano|mxn|pemex|aeromexico|volaris)'
         THEN '["mexico"]'::jsonb
       WHEN question ~* '(latam|latinoamérica|latinoamerica|américa latina|america latina|argentina|brasil|brazil|colombia|chile|peru|uruguay)'
         THEN '["latam"]'::jsonb
       ELSE '[]'::jsonb
     END
   WHERE geo_tags IS NULL OR geo_tags = '[]'::jsonb`,
  `UPDATE points_markets
     SET topic_tags = CASE
       WHEN category IN ('crypto', 'world-cup') THEN to_jsonb(ARRAY[category])
       WHEN resolver_type = 'weather_api' OR question ~* '(weather|temperatura|lluvia)' THEN '["weather"]'::jsonb
       WHEN category = 'mexico' THEN '["general"]'::jsonb
       ELSE to_jsonb(ARRAY[COALESCE(NULLIF(category, ''), 'general')])
     END
   WHERE topic_tags IS NULL OR topic_tags = '[]'::jsonb`,
  `UPDATE points_markets
     SET category_tags = to_jsonb(ARRAY[category])
   WHERE category IN ('crypto', 'world-cup')
     AND (category_tags = '[]'::jsonb OR category_tags ? 'mexico' OR NOT (category_tags ? category))`,
  `UPDATE points_markets
     SET geo_tags = '[]'::jsonb
   WHERE category IN ('crypto', 'world-cup')
     AND geo_tags <> '[]'::jsonb`,
  `UPDATE points_markets
     SET topic_tags = to_jsonb(ARRAY[category])
   WHERE category IN ('crypto', 'world-cup')
     AND (topic_tags = '[]'::jsonb OR topic_tags ? 'mexico' OR NOT (topic_tags ? category))`,

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
  // auto_featured: tracks whether the cron flipped `featured = true`
  // because the market entered its game window (start_time <= now <
  // end_time). Lets us safely auto-unfeature when the game ends
  // without clobbering a market the admin manually featured. Set by
  // /api/cron/points-auto-feature on each tick.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS auto_featured BOOLEAN NOT NULL DEFAULT false`,

  // archived_at: soft-delete timestamp. Populated by /admin/archive-market
  // and NULL for live markets. Archived rows stay in the DB so trade
  // history + positions endpoints keep returning accurate past data,
  // but are filtered out of every public list endpoint by default.
  // Admin lists surface them behind a `?show_archived=1` flag.
  // Partial index keeps the common case (WHERE archived_at IS NULL) fast
  // without the cost of indexing the soft-deleted tail.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_live
    ON points_markets(status, end_time) WHERE archived_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_active_parent_end
    ON points_markets(status, end_time ASC, id ASC)
    WHERE archived_at IS NULL AND parent_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_featured_active_end
    ON points_markets(status, end_time ASC, id ASC)
    WHERE archived_at IS NULL AND parent_id IS NULL AND featured = true`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_category_status_end
    ON points_markets(category, status, end_time ASC, id ASC)
    WHERE archived_at IS NULL AND parent_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_points_markets_resolved_parent_time
    ON points_markets(resolved_at DESC, id ASC)
    WHERE archived_at IS NULL AND parent_id IS NULL AND status = 'resolved'`,

  // source / source_event_id mirror the columns on points_pending_markets
  // so auto-generated markets that bypass the admin queue (e.g. the
  // chainlink-5min crypto markets — created+activated+resolved by cron
  // on a 5-minute boundary) can use the same idempotency pattern. The
  // partial UNIQUE only enforces uniqueness for rows that opt in, so
  // existing markets (which have NULL source columns) are unaffected.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS source TEXT`,
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS source_event_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_points_markets_source_event
    ON points_markets(source, source_event_id)
    WHERE source IS NOT NULL AND source_event_id IS NOT NULL`,

  // ── News → market links ──────────────────────────────────────────────────
  // Admins linking a news headline to an existing market so users
  // browsing /c/noticias can jump to the active market it relates
  // to. Many-to-one in principle (one market, multiple headlines) but
  // we enforce one link per news_url to keep the UI obvious.
  // ON DELETE SET NULL on market_id so resolving / archiving a market
  // doesn't cascade-delete the news link — we just stop showing it.
  `CREATE TABLE IF NOT EXISTS points_news_links (
    id          SERIAL PRIMARY KEY,
    news_url    TEXT UNIQUE NOT NULL,
    news_title  TEXT,
    news_source TEXT,
    market_id   INTEGER REFERENCES points_markets(id) ON DELETE SET NULL,
    linked_by   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_news_links_market
    ON points_news_links(market_id) WHERE market_id IS NOT NULL`,

  // ── News hide list (admin curation) ──────────────────────────────────────
  // Admins flagging individual news items as irrelevant so they
  // disappear from /c/noticias for everyone. Persistent across
  // cache refreshes — even if the same article re-enters the feed
  // from a different fetch, the hidden flag still applies. Soft
  // signal only: rows live forever (until the URL ages out
  // naturally), so undoing is just a DELETE on the same news_url.
  `CREATE TABLE IF NOT EXISTS points_news_hidden (
    id         SERIAL PRIMARY KEY,
    news_url   TEXT UNIQUE NOT NULL,
    news_title TEXT,
    hidden_by  TEXT,
    hidden_at  TIMESTAMPTZ DEFAULT NOW()
  )`,

  // points_news_first_seen — persistent backup for the in-memory
  // firstSeenByUrl Map in news-mexico.js. Outlets like Aristegui /
  // Noroeste / Proceso don't expose datePublished on their homepage
  // cards and many of their article URLs lack /YYYY/MM/DD/ slugs, so
  // the URL-date extractor returns null and we fall back to
  // first-seen-time. Without persistence, a fresh serverless instance
  // starts with an empty Map → every item gets stamped NOW() on its
  // very first refresh → "hace un momento" forever bug. Persisting
  // to a tiny table keyed by news_url survives instance churn.
  //
  // Rows are inserted ON CONFLICT DO NOTHING so the FIRST sighting
  // is the timestamp we keep. GC: news-mexico.js prunes rows older
  // than MAX_AGE_HOURS during each refresh so the table stays bounded.
  `CREATE TABLE IF NOT EXISTS points_news_first_seen (
    news_url      TEXT PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_news_first_seen_age
    ON points_news_first_seen(first_seen_at)`,

  // final_score: human-readable final result for resolved markets.
  // Free-form TEXT so different market types encode what makes sense:
  //   - soccer / baseball match: "2-1", "México 3-2 Brasil"
  //   - basketball / NFL:        "112-108"
  //   - F1:                      "1. Verstappen · 2. Norris · 3. Sainz"
  //   - non-sports resolvers:    "$BTC 98,421 at Dic 31 · Coinbase"
  // Populated at resolve time by the admin (UI prompts for it) or by the
  // auto-resolver when the source API returns final-score data. Capped at
  // 240 chars server-side so we don't blow up card/detail layouts.
  `ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS final_score TEXT`,

  // ── Balances (single source of truth per user) ─────────────────────────
  `CREATE TABLE IF NOT EXISTS points_balances (
    username     TEXT PRIMARY KEY,
    balance      NUMERIC(20,6) NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_balances_rank
    ON points_balances(balance DESC, username ASC)`,

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
  `CREATE INDEX IF NOT EXISTS idx_points_trades_user_created
    ON points_trades(username, created_at DESC, market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_points_trades_market_side_user
    ON points_trades(market_id, side, username)`,
  // tx_hash: on-chain transaction hash for mode='onchain' trades.
  // NULL for DB-backed trades. UNIQUE so an idempotent retry of a
  // confirmed on-chain trade (e.g. user refreshes mid-await) can't
  // insert a duplicate row. The indexer (M5) inserts with ON
  // CONFLICT DO NOTHING against this constraint so live-read and
  // indexer writes can both claim the same on-chain event.
  `ALTER TABLE points_trades ADD COLUMN IF NOT EXISTS tx_hash TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_points_trades_tx_hash ON points_trades(tx_hash) WHERE tx_hash IS NOT NULL`,

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

  // ── Limit orders (reserved bids/asks against the points AMM) ───────────
  // This is a hybrid order book, not a full off-chain CLOB yet:
  //   - buy orders reserve MXNP immediately and fill against the AMM when
  //     the executable average price is at/below the limit.
  //   - sell orders reserve shares immediately and fill against the AMM
  //     when the executable average price is at/above the limit.
  // Keeping reservation in Postgres prevents users from double-spending
  // cash or shares while their order is open.
  `CREATE TABLE IF NOT EXISTS points_limit_orders (
    id                  SERIAL PRIMARY KEY,
    market_id           INTEGER NOT NULL REFERENCES points_markets(id),
    username            TEXT NOT NULL,
    side                TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
    outcome_index       SMALLINT NOT NULL,
    limit_price         NUMERIC(10,6) NOT NULL CHECK (limit_price > 0 AND limit_price < 1),
    amount              NUMERIC(30,18) NOT NULL,
    remaining_amount    NUMERIC(30,18) NOT NULL,
    reserved_collateral NUMERIC(20,6) NOT NULL DEFAULT 0,
    reserved_shares     NUMERIC(30,18) NOT NULL DEFAULT 0,
    maker_reward_accrued NUMERIC(20,6) NOT NULL DEFAULT 0,
    maker_reward_paid    NUMERIC(20,6) NOT NULL DEFAULT 0,
    maker_reward_last_at TIMESTAMPTZ DEFAULT NOW(),
    status              TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'filled', 'cancelled', 'expired')),
    filled_shares       NUMERIC(30,18) NOT NULL DEFAULT 0,
    filled_collateral   NUMERIC(20,6) NOT NULL DEFAULT 0,
    avg_fill_price      NUMERIC(10,6),
    reason              TEXT,
    expires_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    filled_at           TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ
  )`,
  `ALTER TABLE points_limit_orders ADD COLUMN IF NOT EXISTS maker_reward_accrued NUMERIC(20,6) NOT NULL DEFAULT 0`,
  `ALTER TABLE points_limit_orders ADD COLUMN IF NOT EXISTS maker_reward_paid NUMERIC(20,6) NOT NULL DEFAULT 0`,
  `ALTER TABLE points_limit_orders ADD COLUMN IF NOT EXISTS maker_reward_last_at TIMESTAMPTZ DEFAULT NOW()`,
  `CREATE INDEX IF NOT EXISTS idx_points_limit_orders_market_outcome
    ON points_limit_orders(market_id, outcome_index, status, side, limit_price, created_at)
    WHERE status = 'open'`,
  `CREATE INDEX IF NOT EXISTS idx_points_limit_orders_user
    ON points_limit_orders(username, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_points_limit_orders_expiry
    ON points_limit_orders(expires_at)
    WHERE status = 'open' AND expires_at IS NOT NULL`,

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

  // ── Support tickets ─────────────────────────────────────────────────────
  // User-created support threads with admin replies. Outbound email is
  // best-effort through Resend; Postgres remains the source of truth so
  // admins can answer from the dashboard even if mail delivery is down.
  `CREATE TABLE IF NOT EXISTS points_support_tickets (
    id                 SERIAL PRIMARY KEY,
    username           TEXT NOT NULL,
    email              TEXT,
    type               TEXT NOT NULL DEFAULT 'other',
    subject            TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'open',
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    last_user_message_at  TIMESTAMPTZ,
    last_admin_message_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_support_tickets_user
    ON points_support_tickets(username, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_points_support_tickets_status
    ON points_support_tickets(status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS points_support_messages (
    id                 SERIAL PRIMARY KEY,
    ticket_id          INTEGER NOT NULL REFERENCES points_support_tickets(id) ON DELETE CASCADE,
    sender_type        TEXT NOT NULL,
    sender_username    TEXT,
    body               TEXT NOT NULL,
    emailed            BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_support_messages_ticket
    ON points_support_messages(ticket_id, created_at ASC)`,

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
  `CREATE INDEX IF NOT EXISTS idx_points_distributions_created_kind_user
    ON points_distributions(created_at DESC, kind, username)`,
  `CREATE INDEX IF NOT EXISTS idx_points_distributions_user_kind_ref
    ON points_distributions(username, kind, reference_id, created_at DESC)`,

  // ── Site-time analytics (admin-only aggregate) ─────────────────────────
  // The client sends a low-frequency heartbeat while an authenticated user
  // has the page visible. We aggregate by day and username so admin can see
  // engagement share without storing raw browsing sessions.
  `CREATE TABLE IF NOT EXISTS points_site_time_daily (
    username      TEXT NOT NULL,
    day           DATE NOT NULL DEFAULT CURRENT_DATE,
    seconds       INTEGER NOT NULL DEFAULT 0,
    last_path     TEXT,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (username, day)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_site_time_day
    ON points_site_time_daily(day DESC, seconds DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_points_site_time_user
    ON points_site_time_daily(username, day DESC)`,

  // ── Publicity attribution (social bio links) ──────────────────────────
  // Clean URLs like /i, /t, and /x write daily aggregates.
  // A later authenticated session can be attributed once to the source
  // cookie, which lets admin compare channels without raw click logs.
  `CREATE TABLE IF NOT EXISTS points_publicity_daily (
    source          TEXT NOT NULL,
    day             DATE NOT NULL DEFAULT CURRENT_DATE,
    visits          INTEGER NOT NULL DEFAULT 0,
    unique_visitors INTEGER NOT NULL DEFAULT 0,
    conversions     INTEGER NOT NULL DEFAULT 0,
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, day)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_publicity_daily_day
    ON points_publicity_daily(day DESC, source)`,
  `CREATE TABLE IF NOT EXISTS points_publicity_visitors (
    visitor_key    TEXT NOT NULL,
    source         TEXT NOT NULL,
    day            DATE NOT NULL DEFAULT CURRENT_DATE,
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (visitor_key, source, day)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_publicity_visitors_source_day
    ON points_publicity_visitors(source, day DESC)`,
  `CREATE TABLE IF NOT EXISTS points_publicity_attributions (
    username      TEXT PRIMARY KEY,
    source        TEXT NOT NULL,
    visitor_key   TEXT,
    converted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_publicity_attributions_source
    ON points_publicity_attributions(source, converted_at DESC)`,

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
  `CREATE TABLE IF NOT EXISTS social_task_campaigns (
    id             SERIAL PRIMARY KEY,
    task_key       TEXT UNIQUE NOT NULL,
    platform       TEXT NOT NULL,
    target_url     TEXT NOT NULL,
    label          TEXT NOT NULL,
    description    TEXT,
    reward         NUMERIC(20,6) NOT NULL DEFAULT 10,
    hidden         BOOLEAN NOT NULL DEFAULT TRUE,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at     TIMESTAMPTZ NOT NULL,
    created_by     TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_social_task_campaigns_active_expiry
    ON social_task_campaigns(active, expires_at DESC, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_social_task_campaigns_platform
    ON social_task_campaigns(platform, created_at DESC)`,
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
  `ALTER TABLE social_tasks ADD COLUMN IF NOT EXISTS reviewer TEXT`,
  `ALTER TABLE social_tasks ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,
  `ALTER TABLE social_tasks ADD COLUMN IF NOT EXISTS rejection_note TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_social_tasks_status ON social_tasks(status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_social_tasks_review_history
    ON social_tasks(status, reviewed_at DESC, created_at DESC)
    WHERE status IN ('approved', 'rejected')`,

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

  // ── Lightweight app settings ────────────────────────────────────────────
  // Small feature switches that need to survive deploys without introducing
  // a full admin-config service. Values stay JSONB so callers can store booleans
  // or tiny objects while keeping a single table shape.
  `CREATE TABLE IF NOT EXISTS points_app_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT 'null'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

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
  `CREATE INDEX IF NOT EXISTS idx_points_cycles_closed_at
    ON points_cycles(closed_at DESC)
    WHERE status = 'closed'`,

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

  // ── Crypto price ticks (server-side history for the 5-min chart) ─────────
  // Recorded by /api/points/crypto-tick every ~5s for each asset (BTC, ETH)
  // while visitors have the points app open. /api/points/crypto-history
  // serves these to the chart so a fresh page open shows the same dense
  // curve as a continuously-mounted page. Retention: 7 days; older rows
  // are pruned by /api/points/crypto-tick after accepted inserts.
  `CREATE TABLE IF NOT EXISTS crypto_ticks (
    id          BIGSERIAL PRIMARY KEY,
    asset       TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    price       NUMERIC(20,8) NOT NULL,
    UNIQUE(asset, captured_at)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_crypto_ticks_asset_time
    ON crypto_ticks(asset, captured_at DESC)`,

  // ── Frozen crypto market curves (one final chart per resolved 5-min market)
  // Snapshot is written at resolve time from whatever `crypto_ticks` history we
  // have for that market's [openedAt, closesAt] window, plus open/close anchors.
  // Kept off `points_markets` so frequent `SELECT m.*` list/detail queries do
  // not drag large chart blobs through the hot path.
  `CREATE TABLE IF NOT EXISTS points_crypto_market_snapshots (
    market_id   INTEGER PRIMARY KEY REFERENCES points_markets(id) ON DELETE CASCADE,
    asset       TEXT NOT NULL,
    opened_at   TIMESTAMPTZ NOT NULL,
    closes_at   TIMESTAMPTZ NOT NULL,
    points      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_crypto_market_snapshots_asset_close
    ON points_crypto_market_snapshots(asset, closes_at DESC)`,

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

  // ── Resolution candidates (admin review boundary) ─────────────────────────
  // Used by the scheduler for markets that should wake up at close time but
  // should not auto-settle without human confirmation (music, awards,
  // fuzzy/news/sentiment style markets). outcome_index is nullable so a
  // candidate can simply mean "this market is ready for review".
  `CREATE TABLE IF NOT EXISTS points_resolution_candidates (
    id               SERIAL PRIMARY KEY,
    points_market_id INTEGER NOT NULL REFERENCES points_markets(id) ON DELETE CASCADE,
    resolver_type    TEXT NOT NULL DEFAULT 'manual_review',
    source           TEXT,
    source_event_id  TEXT,
    outcome_index    SMALLINT,
    outcome_count    INTEGER NOT NULL DEFAULT 2,
    confidence_bps   INTEGER NOT NULL DEFAULT 0,
    observed_at      TIMESTAMPTZ,
    final_score      TEXT,
    evidence_url     TEXT,
    evidence         JSONB NOT NULL DEFAULT '[]'::jsonb,
    rationale        TEXT,
    raw_report       JSONB,
    status           TEXT NOT NULL DEFAULT 'pending',
    reviewer         TEXT,
    admin_note       TEXT,
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_points_resolution_candidates_market_status
    ON points_resolution_candidates(points_market_id, status, created_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_points_resolution_candidates_one_pending
    ON points_resolution_candidates(points_market_id)
    WHERE status = 'pending'`,

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
    seed_liquidities   JSONB,
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
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS seed_liquidities JSONB`,
  // sport/league mirror the columns on points_markets so the approve
  // path can pass them through verbatim.
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS sport TEXT`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS league TEXT`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS outcome_images JSONB`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS category_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS geo_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE points_pending_markets ADD COLUMN IF NOT EXISTS topic_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  `CREATE INDEX IF NOT EXISTS idx_points_pending_category_tags ON points_pending_markets USING GIN (category_tags)`,
  `CREATE INDEX IF NOT EXISTS idx_points_pending_geo_tags ON points_pending_markets USING GIN (geo_tags)`,
  `CREATE INDEX IF NOT EXISTS idx_points_pending_topic_tags ON points_pending_markets USING GIN (topic_tags)`,
  `UPDATE points_pending_markets
     SET category_tags = to_jsonb(ARRAY[category])
   WHERE category IN ('crypto', 'world-cup')
     AND (category_tags = '[]'::jsonb OR category_tags ? 'mexico' OR NOT (category_tags ? category))`,
  `UPDATE points_pending_markets
     SET geo_tags = '[]'::jsonb
   WHERE category IN ('crypto', 'world-cup')
     AND geo_tags <> '[]'::jsonb`,
  `UPDATE points_pending_markets
     SET topic_tags = to_jsonb(ARRAY[category])
   WHERE category IN ('crypto', 'world-cup')
     AND (topic_tags = '[]'::jsonb OR topic_tags ? 'mexico' OR NOT (topic_tags ? category))`,
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

const TRANSIENT_MIGRATION_ERROR_CODES = new Set([
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled / statement_timeout
]);

function isIdempotentError(err) {
  if (!err) return false;
  if (IDEMPOTENT_ERROR_CODES.has(err.code)) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('already exists');
}

function isTransientMigrationError(err) {
  return !!err && TRANSIENT_MIGRATION_ERROR_CODES.has(err.code);
}

async function schemaLooksReady(sql) {
  const rows = await sql.query(POINTS_SCHEMA_READY_PROBE);
  const row = rows?.[0];
  return !!row && Object.values(row).every(Boolean);
}

async function tryAcquireSchemaLock(sql) {
  try {
    await sql.query(POINTS_SCHEMA_LOCK_TABLE);
  } catch (err) {
    if (!isIdempotentError(err)) throw err;
  }

  const rows = await sql.query(`
    INSERT INTO points_schema_locks (name, locked_until, updated_at)
    VALUES ('points', NOW() + INTERVAL '${POINTS_SCHEMA_LOCK_LEASE_SECONDS} seconds', NOW())
    ON CONFLICT (name) DO UPDATE
      SET locked_until = EXCLUDED.locked_until,
          updated_at = NOW()
      WHERE points_schema_locks.locked_until < NOW()
    RETURNING true AS acquired
  `);
  return rows?.[0]?.acquired === true;
}

async function releaseSchemaLock(sql) {
  try {
    await sql.query(`
      UPDATE points_schema_locks
         SET locked_until = NOW(),
             updated_at = NOW()
       WHERE name = 'points'
    `);
  } catch {
    // Best effort. The lease expires quickly if this update cannot run.
  }
}

async function runSchemaMigration(sql, migration) {
  if (typeof sql.transaction === 'function') {
    await sql.transaction((tx) => [
      tx.query(`SET LOCAL lock_timeout = '2500ms'`),
      tx.query(`SET LOCAL statement_timeout = '15000ms'`),
      tx.query(migration),
    ]);
    return;
  }
  await sql.query(migration);
}

export async function ensurePointsSchema(sql) {
  if (pointsSchemaReady) return;
  if (!pointsSchemaProbeReady) {
    try {
      if (await schemaLooksReady(sql)) {
        pointsSchemaProbeReady = true;
        pointsSchemaReady = true;
        return;
      }
    } catch {
      // Fall through to self-healing migrations. The probe is an optimization,
      // not the source of truth.
    }
  }

  const acquired = await tryAcquireSchemaLock(sql);
  if (!acquired) {
    // Another serverless instance is already running DDL. Do not let hot
    // routes pile up behind relation locks; the request can proceed against
    // the existing schema, or fail fast if it genuinely needs a missing object.
    return;
  }

  try {
    for (const migration of POINTS_SCHEMA_MIGRATIONS) {
      try {
        await runSchemaMigration(sql, migration);
      } catch (err) {
        if (isIdempotentError(err)) {
          // Another concurrent cold-start already created this object —
          // end state is correct, keep going.
          continue;
        }
        if (isTransientMigrationError(err) && await schemaLooksReady(sql).catch(() => false)) {
          pointsSchemaProbeReady = true;
          pointsSchemaReady = true;
          return;
        }
        throw err;
      }
    }
    pointsSchemaProbeReady = true;
    pointsSchemaReady = true;
  } finally {
    await releaseSchemaLock(sql);
  }
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
