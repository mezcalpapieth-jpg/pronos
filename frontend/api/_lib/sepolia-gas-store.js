// Separate from protocol/Points cold-start migrations: the read-only indexer
// never needs these tables. Install explicitly in the isolated preview DB.
export const SEPOLIA_GAS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sepolia_gas_lock (
    chain_id integer PRIMARY KEY CHECK (chain_id = 421614),
    funder_address text NOT NULL,
    lease_token uuid NOT NULL,
    lease_until timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sepolia_gas_transfers (
    tx_hash text PRIMARY KEY,
    chain_id integer NOT NULL CHECK (chain_id = 421614),
    funder_address text NOT NULL,
    wallet_address text NOT NULL,
    suborg_id text NOT NULL,
    signer_key_hash text NOT NULL,
    amount_wei numeric(78,0) NOT NULL CHECK (amount_wei > 0 AND amount_wei <= 500000000000000),
    max_cost_wei numeric(78,0) NOT NULL CHECK (max_cost_wei >= amount_wei),
    nonce bigint NOT NULL,
    signed_tx text NOT NULL,
    status text NOT NULL CHECK (status IN ('prepared', 'confirmed', 'reverted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    UNIQUE (chain_id, funder_address, nonce)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sepolia_gas_one_pending
    ON sepolia_gas_transfers (chain_id) WHERE status = 'prepared'`,
  `CREATE INDEX IF NOT EXISTS sepolia_gas_budget ON sepolia_gas_transfers (created_at)`,
];

export function sepoliaGasStore(sql) {
  return {
    async acquire(funder, token) {
      const rows = await sql`
        INSERT INTO sepolia_gas_lock (chain_id, funder_address, lease_token, lease_until)
        VALUES (421614, ${funder}, ${token}, now() + interval '60 seconds')
        ON CONFLICT (chain_id) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
        WHERE sepolia_gas_lock.lease_until < now() AND sepolia_gas_lock.funder_address = EXCLUDED.funder_address
        RETURNING chain_id`;
      return rows.length === 1;
    },
    async release(token) {
      await sql`UPDATE sepolia_gas_lock SET lease_until = now() - interval '1 second'
        WHERE chain_id = 421614 AND lease_token = ${token}`;
    },
    async pending() {
      const [row] = await sql`SELECT * FROM sepolia_gas_transfers WHERE chain_id = 421614 AND status = 'prepared'`;
      return row;
    },
    async prepare(entry, token, settings) {
      // Fence stale workers before persisting a signature. The global lease
      // serializes budget decisions, nonce allocation and balance rechecks.
      const rows = await sql`
        WITH held AS (
          SELECT chain_id FROM sepolia_gas_lock WHERE chain_id = 421614
            AND lease_token = ${token} AND lease_until > now() FOR UPDATE
        )
        INSERT INTO sepolia_gas_transfers
          (tx_hash, chain_id, funder_address, wallet_address, suborg_id, signer_key_hash, amount_wei, max_cost_wei, nonce, signed_tx, status)
        SELECT ${entry.tx_hash}, 421614, ${entry.funder_address}, ${entry.wallet_address}, ${entry.suborg_id},
          ${entry.signer_key_hash}, ${entry.amount_wei}, ${entry.max_cost_wei}, ${entry.nonce}, ${entry.signed_tx}, 'prepared'
        FROM held
        WHERE NOT EXISTS (SELECT 1 FROM sepolia_gas_transfers WHERE status = 'prepared')
          AND NOT EXISTS (SELECT 1 FROM sepolia_gas_transfers
            WHERE (wallet_address = ${entry.wallet_address} OR suborg_id = ${entry.suborg_id})
              AND created_at > now() - interval '5 minutes')
          AND (SELECT COALESCE(SUM(amount_wei), 0) FROM sepolia_gas_transfers
            WHERE (wallet_address = ${entry.wallet_address} OR suborg_id = ${entry.suborg_id})
              AND (created_at > now() - interval '24 hours' OR status = 'prepared'))
            + ${entry.amount_wei}::numeric <= ${settings.walletDaily.toString()}::numeric
          AND (SELECT COALESCE(SUM(max_cost_wei), 0) FROM sepolia_gas_transfers
            WHERE created_at > now() - interval '24 hours' OR status = 'prepared')
            + ${entry.max_cost_wei}::numeric <= ${settings.globalDaily.toString()}::numeric
        RETURNING tx_hash`;
      return rows.length === 1;
    },
    async settle(hash, status) {
      await sql`UPDATE sepolia_gas_transfers SET status = ${status}, confirmed_at = now()
        WHERE tx_hash = ${hash} AND status = 'prepared'`;
    },
  };
}
