// Explicit preview migration, never part of protocol/Points cold starts.
export const SEPOLIA_TOURNAMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_cycles (
    cycle_id text PRIMARY KEY,
    token_address text NOT NULL UNIQUE,
    factory_v1 text NOT NULL UNIQUE,
    factory_v2 text NOT NULL UNIQUE,
    router_address text NOT NULL UNIQUE,
    plan_hash text NOT NULL UNIQUE CHECK (length(plan_hash) = 64),
    plan jsonb NOT NULL,
    status text NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'funded')),
    created_at timestamptz NOT NULL DEFAULT now(),
    funded_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_lock (
    owner_address text PRIMARY KEY,
    lease_token uuid NOT NULL,
    lease_until timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_mints (
    tx_hash text PRIMARY KEY,
    cycle_id text NOT NULL REFERENCES sepolia_tournament_cycles(cycle_id),
    batch_index integer NOT NULL CHECK (batch_index >= 0),
    owner_address text NOT NULL,
    nonce bigint NOT NULL CHECK (nonce >= 0),
    amount_units numeric(78,0) NOT NULL CHECK (amount_units > 0),
    signed_tx text NOT NULL,
    status text NOT NULL CHECK (status IN ('prepared', 'confirmed', 'reverted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    UNIQUE(owner_address, nonce)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sepolia_tournament_one_pending
    ON sepolia_tournament_mints(owner_address) WHERE status = 'prepared'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sepolia_tournament_once_per_batch
    ON sepolia_tournament_mints(cycle_id, batch_index) WHERE status <> 'reverted'`,
];

export function tournamentStore(sql) {
  return {
    async register(plan, hash) {
      await sql`INSERT INTO sepolia_tournament_cycles
        (cycle_id, token_address, factory_v1, factory_v2, router_address, plan_hash, plan)
        VALUES (${plan.cycleId}, ${plan.deployment.token}, ${plan.deployment.factoryV1},
          ${plan.deployment.factoryV2}, ${plan.deployment.router}, ${hash}, ${JSON.stringify(plan)}::jsonb)
        ON CONFLICT (cycle_id) DO NOTHING`;
      const row = await this.cycle(plan.cycleId);
      if (row.plan_hash !== hash) throw new Error('cycle_snapshot_is_immutable');
      return row;
    },
    async cycle(id) {
      const [row] = await sql`SELECT * FROM sepolia_tournament_cycles WHERE cycle_id = ${id}`;
      if (!row) throw new Error('cycle_not_found');
      return row;
    },
    async acquire(owner, token) {
      const rows = await sql`INSERT INTO sepolia_tournament_lock (owner_address, lease_token, lease_until)
        VALUES (${owner}, ${token}, now() + interval '60 seconds')
        ON CONFLICT (owner_address) DO UPDATE SET lease_token = EXCLUDED.lease_token, lease_until = EXCLUDED.lease_until
        WHERE sepolia_tournament_lock.lease_until < now() RETURNING owner_address`;
      return rows.length === 1;
    },
    async release(owner, token) {
      await sql`UPDATE sepolia_tournament_lock SET lease_until = now() - interval '1 second'
        WHERE owner_address = ${owner} AND lease_token = ${token}`;
    },
    async pending(owner) {
      const [row] = await sql`SELECT * FROM sepolia_tournament_mints WHERE owner_address = ${owner} AND status = 'prepared'`;
      return row;
    },
    async attempts(id) {
      // Deliberately omit signed transactions from audit/status output.
      return sql`SELECT tx_hash, batch_index, nonce, amount_units::text, status
        FROM sepolia_tournament_mints WHERE cycle_id = ${id} ORDER BY batch_index, created_at`;
    },
    async verifyRecipients(batch) {
      const recipients = batch.recipients.filter(r => r.kind === 'user');
      if (!recipients.length) return;
      const rows = await sql`SELECT LOWER(username) AS username, LOWER(wallet_address) AS wallet, turnkey_sub_org_id AS suborg
        FROM points_users WHERE LOWER(username) = ANY(${recipients.map(r => r.username)}::text[])
          OR LOWER(wallet_address) = ANY(${recipients.map(r => r.wallet)}::text[])
          OR turnkey_sub_org_id = ANY(${recipients.map(r => r.suborg)}::text[])`;
      for (const recipient of recipients) {
        const matches = rows.filter(r => r.username === recipient.username || r.wallet === recipient.wallet || r.suborg === recipient.suborg);
        if (matches.length !== 1 || matches[0].username !== recipient.username || matches[0].wallet !== recipient.wallet
          || matches[0].suborg !== recipient.suborg) throw new Error('recipient_mapping_changed_since_snapshot');
      }
    },
    async prepare(entry, token) {
      const rows = await sql`WITH held AS (
        SELECT owner_address FROM sepolia_tournament_lock WHERE owner_address = ${entry.owner}
          AND lease_token = ${token} AND lease_until > now() FOR UPDATE
      ) INSERT INTO sepolia_tournament_mints
        (tx_hash, cycle_id, batch_index, owner_address, nonce, amount_units, signed_tx, status)
      SELECT ${entry.hash}, ${entry.cycleId}, ${entry.batchIndex}, ${entry.owner}, ${entry.nonce},
        ${entry.units}, ${entry.signed}, 'prepared' FROM held
      WHERE EXISTS (SELECT 1 FROM sepolia_tournament_cycles WHERE cycle_id = ${entry.cycleId}
        AND plan_hash = ${entry.planHash} AND status = 'prepared'
        AND plan->'deployment'->>'owner' = ${entry.owner}
        AND (plan->'batches'->${entry.batchIndex}::integer->>'units')::numeric = ${entry.units}::numeric
        AND (SELECT COALESCE(SUM(amount_units),0) FROM sepolia_tournament_mints
          WHERE cycle_id = ${entry.cycleId} AND status <> 'reverted') + ${entry.units}::numeric
            <= (plan->>'totalUnits')::numeric
        AND (plan->>'totalUnits')::numeric <= (plan->>'maxTotalUnits')::numeric)
      RETURNING tx_hash`;
      if (rows.length !== 1) throw new Error('mint_lease_or_cycle_changed');
    },
    async settle(hash, status) {
      if (!['confirmed', 'reverted'].includes(status)) throw new Error('invalid_mint_status');
      await sql`UPDATE sepolia_tournament_mints SET status = ${status}, confirmed_at = now()
        WHERE tx_hash = ${hash} AND status = 'prepared'`;
    },
    async finish(id, token, owner) {
      const rows = await sql`UPDATE sepolia_tournament_cycles c SET status = 'funded', funded_at = now()
        WHERE c.cycle_id = ${id} AND c.status = 'prepared'
          AND EXISTS (SELECT 1 FROM sepolia_tournament_lock WHERE owner_address = ${owner}
            AND lease_token = ${token} AND lease_until > now())
          AND (SELECT COUNT(*) FROM sepolia_tournament_mints WHERE cycle_id = c.cycle_id AND status = 'confirmed')
            = jsonb_array_length(c.plan->'batches')
          AND NOT EXISTS (SELECT 1 FROM sepolia_tournament_mints WHERE cycle_id = c.cycle_id AND status = 'prepared')
          AND (SELECT COALESCE(SUM(amount_units),0) FROM sepolia_tournament_mints
            WHERE cycle_id = c.cycle_id AND status = 'confirmed') = (c.plan->>'totalUnits')::numeric
        RETURNING cycle_id`;
      if (rows.length !== 1) throw new Error('cycle_funding_incomplete_or_lease_expired');
    },
  };
}
