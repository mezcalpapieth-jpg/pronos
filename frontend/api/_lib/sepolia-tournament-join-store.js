// Explicit future-cycle migration; never applied by a request/cold start.
export const SEPOLIA_TOURNAMENT_JOIN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_joins (
    tx_hash text PRIMARY KEY,
    cycle_id text NOT NULL REFERENCES sepolia_tournament_cycles(cycle_id),
    plan_hash text NOT NULL,
    username text NOT NULL,
    wallet_address text NOT NULL,
    suborg_id text NOT NULL,
    funder_address text NOT NULL,
    nonce bigint NOT NULL CHECK (nonce >= 0),
    amount_units numeric(78,0) NOT NULL CHECK (amount_units > 0),
    signed_tx text NOT NULL,
    status text NOT NULL CHECK (status IN ('prepared','confirmed','reverted')),
    created_at timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz,
    UNIQUE(funder_address, nonce)
  )`,
  ...['username', 'wallet_address', 'suborg_id'].map(column =>
    `CREATE UNIQUE INDEX IF NOT EXISTS sepolia_join_once_${column}
      ON sepolia_tournament_joins(cycle_id, ${column}) WHERE status <> 'reverted'`),
  `CREATE UNIQUE INDEX IF NOT EXISTS sepolia_join_one_pending
    ON sepolia_tournament_joins(funder_address) WHERE status = 'prepared'`,
];

export function tournamentJoinStore(sql, base) {
  return { ...base,
    async user(suborg) {
      const rows = await sql`SELECT LOWER(username) AS username, LOWER(wallet_address) AS wallet,
        turnkey_sub_org_id AS suborg FROM points_users WHERE turnkey_sub_org_id = ${suborg}`;
      if (rows.length !== 1 || !rows[0].wallet) throw Error('unique_wallet_account_required');
      const u = rows[0];
      const duplicates = await sql`SELECT username FROM points_users
        WHERE LOWER(username) = ${u.username} OR LOWER(wallet_address) = ${u.wallet} OR turnkey_sub_org_id = ${suborg}`;
      if (duplicates.length !== 1) throw Error('unique_wallet_account_required');
      return u;
    },
    async join(cycleId, user) {
      const rows = await sql`SELECT * FROM sepolia_tournament_joins WHERE cycle_id = ${cycleId}
        AND (username = ${user.username} OR wallet_address = ${user.wallet} OR suborg_id = ${user.suborg})
        AND status <> 'reverted'`;
      if (rows.length > 1) throw Error('join_identity_changed');
      const r = rows[0];
      if (r && (r.username !== user.username || r.wallet_address !== user.wallet || r.suborg_id !== user.suborg)) throw Error('join_identity_changed');
      return r;
    },
    async pendingJoin(funder) {
      const [row] = await sql`SELECT * FROM sepolia_tournament_joins WHERE funder_address = ${funder} AND status = 'prepared'`;
      return row;
    },
    async prepareJoin(e, lease) {
      const rows = await sql`WITH held AS (
        SELECT owner_address FROM sepolia_tournament_lock WHERE owner_address = ${e.funder}
          AND lease_token = ${lease} AND lease_until > now() FOR UPDATE
      ) INSERT INTO sepolia_tournament_joins
        (tx_hash,cycle_id,plan_hash,username,wallet_address,suborg_id,funder_address,nonce,amount_units,signed_tx,status)
      SELECT ${e.hash},${e.cycleId},${e.planHash},${e.username},${e.wallet},${e.suborg},${e.funder},
        ${e.nonce},${e.units},${e.signed},'prepared' FROM held
      WHERE EXISTS (SELECT 1 FROM sepolia_tournament_cycles c WHERE c.cycle_id = ${e.cycleId}
        AND c.status = 'funded' AND c.plan_hash = ${e.planHash}
        AND c.plan->>'lateJoining' = 'open_during_cycle'
        AND c.plan->'deployment'->>'operations' = ${e.funder}
        AND c.plan->>'allocationUnits' = ${e.units}
        AND now() >= (c.plan->>'startsAt')::timestamptz AND now() < (c.plan->>'endsAt')::timestamptz
        AND (SELECT COALESCE(SUM(amount_units),0) FROM sepolia_tournament_joins
          WHERE cycle_id = c.cycle_id AND status <> 'reverted') + ${e.units}::numeric
          <= (c.plan->>'lateJoinReserveUnits')::numeric)
      AND (SELECT COUNT(*) FROM points_users WHERE LOWER(username) = ${e.username}
        OR LOWER(wallet_address) = ${e.wallet} OR turnkey_sub_org_id = ${e.suborg}) = 1
      AND EXISTS (SELECT 1 FROM points_users WHERE LOWER(username) = ${e.username}
        AND LOWER(wallet_address) = ${e.wallet} AND turnkey_sub_org_id = ${e.suborg})
      RETURNING tx_hash`;
      if (rows.length !== 1) throw Error('join_lease_budget_identity_or_window_changed');
    },
    async settleJoin(hash, status) {
      if (!['confirmed','reverted'].includes(status)) throw Error('invalid_join_status');
      await sql`UPDATE sepolia_tournament_joins SET status = ${status}, confirmed_at = now()
        WHERE tx_hash = ${hash} AND status = 'prepared'`;
    },
  };
}
