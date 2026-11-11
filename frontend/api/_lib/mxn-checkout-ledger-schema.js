// Install explicitly on the isolated database. Public checkout never runs DDL.
export const MXN_CHECKOUT_LEDGER_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mxn_checkout_ledger_entries (
    environment text NOT NULL CHECK (environment IN ('testnet', 'mainnet')),
    source text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('deposit', 'withdrawal', 'fill', 'builder_payout')),
    reference text NOT NULL,
    venue text NOT NULL,
    account_id text NOT NULL,
    asset text NOT NULL,
    PRIMARY KEY (environment, source, kind, reference),
    CHECK ((venue = 'hip4' AND asset = 'USDC') OR (venue = 'polymarket' AND asset = 'pUSD'))
  )`,
  `CREATE INDEX IF NOT EXISTS mxn_checkout_ledger_account
    ON mxn_checkout_ledger_entries (environment, venue, account_id, kind)`,
  `CREATE TABLE IF NOT EXISTS mxn_checkout_ledger_events (
    environment text NOT NULL,
    source text NOT NULL,
    kind text NOT NULL,
    reference text NOT NULL,
    event_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed')),
    occurred_at timestamptz NOT NULL,
    amount numeric(56,18) CHECK (amount > 0),
    mxn_amount numeric(20,2) CHECK (mxn_amount > 0),
    quote_id text,
    market_id text,
    order_id text,
    side text CHECK (side IN ('buy', 'sell')),
    shares numeric(56,18) CHECK (shares > 0),
    venue_fee_amount numeric(56,18) CHECK (venue_fee_amount >= 0),
    builder_fee_amount numeric(56,18) CHECK (builder_fee_amount >= 0),
    PRIMARY KEY (environment, source, event_id),
    FOREIGN KEY (environment, source, kind, reference)
      REFERENCES mxn_checkout_ledger_entries (environment, source, kind, reference),
    UNIQUE (environment, source, kind, reference, status),
    CHECK (status <> 'confirmed' OR amount IS NOT NULL),
    CHECK (kind IN ('deposit', 'withdrawal')
      OR (status = 'confirmed' AND mxn_amount IS NULL AND quote_id IS NULL)),
    CHECK (kind <> 'fill'
      OR (market_id IS NOT NULL AND order_id IS NOT NULL AND side IS NOT NULL AND shares IS NOT NULL)),
    CHECK (kind = 'fill'
      OR (market_id IS NULL AND order_id IS NULL AND side IS NULL AND shares IS NULL
        AND venue_fee_amount IS NULL AND builder_fee_amount IS NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mxn_checkout_ledger_terminal_event
    ON mxn_checkout_ledger_events (environment, source, kind, reference)
    WHERE status IN ('confirmed', 'failed')`,
];
