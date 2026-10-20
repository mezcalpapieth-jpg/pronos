// Install explicitly, outside API/indexer hot paths. Signed payloads are
// server-only bearer capabilities and must never be included in API responses.
export const TRADE_REQUEST_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sepolia_trade_requests (
    id uuid PRIMARY KEY,
    chain_id integer NOT NULL CHECK (chain_id = 421614),
    wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
    suborg_id text NOT NULL,
    request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 128),
    action text NOT NULL CHECK (action IN ('buy','sell','redeem')),
    payload_hash text NOT NULL,
    payload jsonb NOT NULL,
    plan jsonb,
    status text NOT NULL DEFAULT 'created' CHECK (status IN
      ('created','validated','pending','confirmed','reverted','rejected','needs_reconciliation')),
    result jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, wallet_address, request_key),
    UNIQUE (id, chain_id, wallet_address)
  )`,
  `CREATE TABLE IF NOT EXISTS sepolia_trade_wallet_leases (
    chain_id integer NOT NULL CHECK (chain_id = 421614),
    wallet_address text NOT NULL,
    lease_token uuid NOT NULL,
    lease_until timestamptz NOT NULL,
    PRIMARY KEY (chain_id, wallet_address)
  )`,
  `CREATE TABLE IF NOT EXISTS sepolia_trade_transactions (
    request_id uuid NOT NULL,
    step text NOT NULL CHECK (step IN ('collateral_approval','share_approval','trade')),
    chain_id integer NOT NULL CHECK (chain_id = 421614),
    wallet_address text NOT NULL,
    nonce bigint NOT NULL CHECK (nonce >= 0),
    unsigned_tx text NOT NULL,
    tx_hash text UNIQUE,
    signed_tx text,
    status text NOT NULL CHECK (status IN ('reserved','signed','confirmed','reverted','needs_reconciliation')),
    receipt jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (request_id, step),
    FOREIGN KEY (request_id, chain_id, wallet_address)
      REFERENCES sepolia_trade_requests(id, chain_id, wallet_address),
    UNIQUE (chain_id, wallet_address, nonce),
    CHECK ((signed_tx IS NULL AND tx_hash IS NULL AND status = 'reserved')
      OR (signed_tx IS NOT NULL AND tx_hash IS NOT NULL AND status <> 'reserved'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sepolia_trade_one_unsettled_wallet_tx
    ON sepolia_trade_transactions (chain_id, wallet_address)
    WHERE status IN ('reserved','signed','needs_reconciliation')`,
  `CREATE INDEX IF NOT EXISTS sepolia_trade_requests_owner
    ON sepolia_trade_requests (suborg_id, created_at DESC)`,
];

// The pinned preview's owner default privileges grant reader access to every
// new table. Override those defaults in the same transaction as installation.
// The application also needs DELETE solely to discard unsigned reservations.
const tradeTables = 'sepolia_trade_requests, sepolia_trade_wallet_leases, sepolia_trade_transactions';
export const TRADE_REQUEST_PRIVILEGES = [
  `REVOKE ALL PRIVILEGES ON TABLE ${tradeTables} FROM PUBLIC, pronos_reader, sepolia_indexer, sepolia_standings`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${tradeTables} TO pronos_writer`,
];

const rowsOf = result => Array.isArray(result) ? result : result.rows;
export function tradeRequestStore(sql) {
  const query = async (parts, ...values) => rowsOf(await sql(parts, ...values));
  return {
    async create(entry) {
      await query`INSERT INTO sepolia_trade_requests
        (id, chain_id, wallet_address, suborg_id, request_key, action, payload_hash, payload)
        VALUES (${entry.id}, 421614, ${entry.wallet}, ${entry.suborg}, ${entry.key},
          ${entry.action}, ${entry.hash}, ${JSON.stringify(entry.payload)}::jsonb)
        ON CONFLICT (chain_id, wallet_address, request_key) DO NOTHING`;
      return this.find(entry.wallet, entry.key);
    },
    async find(wallet, key) {
      return (await query`SELECT * FROM sepolia_trade_requests
        WHERE chain_id = 421614 AND wallet_address = ${wallet} AND request_key = ${key}`)[0];
    },
    async recoverable(wallet, suborg) {
      return (await query`SELECT r.* FROM sepolia_trade_requests r
        WHERE r.chain_id = 421614 AND r.wallet_address = ${wallet} AND r.suborg_id = ${suborg}
          AND r.status IN ('created','validated','pending','needs_reconciliation')
        ORDER BY EXISTS (SELECT 1 FROM sepolia_trade_transactions t WHERE t.request_id = r.id
          AND t.status IN ('reserved','signed','needs_reconciliation')) DESC, r.created_at, r.id LIMIT 1`)[0];
    },
    async acquire(wallet, token) {
      return (await query`INSERT INTO sepolia_trade_wallet_leases
        (chain_id, wallet_address, lease_token, lease_until)
        VALUES (421614, ${wallet}, ${token}, now() + interval '60 seconds')
        ON CONFLICT (chain_id, wallet_address) DO UPDATE
          SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
          WHERE sepolia_trade_wallet_leases.lease_until < now()
        RETURNING wallet_address`).length === 1;
    },
    async renew(wallet, token) {
      return (await query`UPDATE sepolia_trade_wallet_leases SET lease_until = now() + interval '60 seconds'
        WHERE chain_id = 421614 AND wallet_address = ${wallet} AND lease_token = ${token}
          AND lease_until > now() RETURNING wallet_address`).length === 1;
    },
    async release(wallet, token) {
      await query`UPDATE sepolia_trade_wallet_leases SET lease_until = now() - interval '1 second'
        WHERE chain_id = 421614 AND wallet_address = ${wallet} AND lease_token = ${token}`;
    },
    async update(entry, token, { status, plan = null, result = null }) {
      return (await query`WITH held AS (
        SELECT wallet_address FROM sepolia_trade_wallet_leases
        WHERE chain_id = 421614 AND wallet_address = ${entry.wallet_address}
          AND lease_token = ${token} AND lease_until > now() FOR UPDATE
      ) UPDATE sepolia_trade_requests r SET status = ${status},
        plan = COALESCE(r.plan, ${plan && JSON.stringify(plan)}::jsonb),
        result = COALESCE(r.result, ${result && JSON.stringify(result)}::jsonb), updated_at = now()
        FROM held WHERE r.id = ${entry.id} AND r.wallet_address = held.wallet_address
        RETURNING r.id`).length === 1;
    },
    async transactions(id) {
      return query`SELECT * FROM sepolia_trade_transactions WHERE request_id = ${id} ORDER BY nonce`;
    },
    async unsettled(wallet) {
      return (await query`SELECT * FROM sepolia_trade_transactions WHERE chain_id = 421614
        AND wallet_address = ${wallet} AND status IN ('reserved','signed','needs_reconciliation') LIMIT 1`)[0];
    },
    async reserve(entry, token, { step, nonce, unsigned }) {
      return (await query`WITH held AS (
        SELECT wallet_address FROM sepolia_trade_wallet_leases
        WHERE chain_id = 421614 AND wallet_address = ${entry.wallet_address}
          AND lease_token = ${token} AND lease_until > now() FOR UPDATE
      ) INSERT INTO sepolia_trade_transactions
        (request_id, step, chain_id, wallet_address, nonce, unsigned_tx, status)
        SELECT ${entry.id}, ${step}, 421614, held.wallet_address, ${nonce}, ${unsigned}, 'reserved'
        FROM held RETURNING *`)[0];
    },
    async sign(entry, token, tx, { signed, hash }) {
      return (await query`WITH held AS (
        SELECT wallet_address FROM sepolia_trade_wallet_leases
        WHERE chain_id = 421614 AND wallet_address = ${entry.wallet_address}
          AND lease_token = ${token} AND lease_until > now() FOR UPDATE
      ) UPDATE sepolia_trade_transactions t SET signed_tx = ${signed}, tx_hash = ${hash},
          status = 'signed', updated_at = now() FROM held
        WHERE t.request_id = ${entry.id} AND t.step = ${tx.step} AND t.status = 'reserved'
          AND t.wallet_address = held.wallet_address RETURNING t.*`)[0];
    },
    async settle(entry, token, tx, status, receipt = null) {
      return (await query`WITH held AS (
        SELECT wallet_address FROM sepolia_trade_wallet_leases
        WHERE chain_id = 421614 AND wallet_address = ${entry.wallet_address}
          AND lease_token = ${token} AND lease_until > now() FOR UPDATE
      ) UPDATE sepolia_trade_transactions t SET status = ${status},
          receipt = COALESCE(t.receipt, ${receipt && JSON.stringify(receipt)}::jsonb), updated_at = now()
        FROM held WHERE t.request_id = ${tx.request_id} AND t.step = ${tx.step}
          AND t.wallet_address = held.wallet_address AND t.status IN ('signed','needs_reconciliation')
        RETURNING t.*`)[0];
    },
    async discardUnsigned(entry, token) {
      // Safe only before persisted signing. A stale signer cannot update a
      // deleted reservation because both persistence and deletion are fenced.
      await query`WITH held AS (
        SELECT wallet_address FROM sepolia_trade_wallet_leases
        WHERE chain_id = 421614 AND wallet_address = ${entry.wallet_address}
          AND lease_token = ${token} AND lease_until > now() FOR UPDATE
      ) DELETE FROM sepolia_trade_transactions t USING held
        WHERE t.request_id = ${entry.id} AND t.wallet_address = held.wallet_address
          AND t.status = 'reserved' AND t.signed_tx IS NULL`;
    },
  };
}
