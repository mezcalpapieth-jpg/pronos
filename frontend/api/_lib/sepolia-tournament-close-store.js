import { randomUUID } from 'node:crypto';
import { planHash, seasonLateJoinsHash } from './sepolia-tournament.js';

// Installed only by the explicit future-tournament migration command.
export const SEPOLIA_TOURNAMENT_CLOSE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_closures (
    cycle_id text PRIMARY KEY REFERENCES sepolia_tournament_cycles(cycle_id),
    plan_hash text NOT NULL CHECK (length(plan_hash)=64),
    result_hash text NOT NULL UNIQUE CHECK (length(result_hash)=64),
    result jsonb NOT NULL,
    closed_at timestamptz NOT NULL DEFAULT now(),
    CHECK (result->>'status'='closed' AND result->>'readyForRewards'='false'),
    CHECK (result->>'cycleId'=cycle_id AND result->>'planHash'=plan_hash AND result->>'resultHash'=result_hash)
  )`,
  `CREATE OR REPLACE FUNCTION sepolia_tournament_frozen_result() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'season_result_is_immutable'; END $$`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sepolia_tournament_frozen_result') THEN
    CREATE TRIGGER sepolia_tournament_frozen_result BEFORE UPDATE OR DELETE ON sepolia_tournament_closures
    FOR EACH ROW EXECUTE FUNCTION sepolia_tournament_frozen_result(); END IF; END $$`,
];

export function tournamentCloseStore(sql) {
  return {
    async read(cycleId) {
      const rows=await sql`SELECT result FROM sepolia_tournament_closures WHERE cycle_id=${cycleId}`;
      return (Array.isArray(rows)?rows:rows.rows)?.[0]?.result || null;
    },
    async close(result) {
      const {resultHash,...body}=result;
      if (resultHash!==planHash(body) || result.status!=='closed' || result.readyForRewards!==false) throw Error('invalid_season_result');
      const existing=await this.read(result.cycleId);
      if (existing) {
        if (existing.resultHash!==resultHash) throw Error('season_result_is_immutable');
        return existing;
      }
      // Share enrollment's operations-wallet lease: no join can be prepared or
      // reconciled between reading its ledger and persisting the frozen result.
      // Each query gets a fresh snapshot after acquiring the lease.
      const lease=randomUUID(), acquired=await sql`INSERT INTO sepolia_tournament_lock(owner_address,lease_token,lease_until)
        SELECT plan->'deployment'->>'operations',${lease},now()+interval '60 seconds'
        FROM sepolia_tournament_cycles WHERE cycle_id=${result.cycleId} AND status='funded'
          AND plan_hash=${result.planHash} AND plan->'deployment'->>'token'=${result.token}
          AND (plan->>'endsAt')::timestamptz<=now()
        ON CONFLICT(owner_address) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
        WHERE sepolia_tournament_lock.lease_until<now() RETURNING owner_address`;
      const owner=(Array.isArray(acquired)?acquired:acquired.rows)?.[0]?.owner_address;
      if (!owner) throw Error('season_not_funded_ended_or_funder_busy');
      try {
        const response=await sql`SELECT tx_hash,username,wallet_address,suborg_id,amount_units::text,plan_hash,status
          FROM sepolia_tournament_joins WHERE cycle_id=${result.cycleId} AND status<>'reverted'`;
        const joins=Array.isArray(response)?response:response.rows;
        if (joins.some(r=>r.status==='prepared')) throw Error('season_joins_pending');
        if (seasonLateJoinsHash(joins.map(r=>({txHash:r.tx_hash,username:r.username,wallet:r.wallet_address,
          suborg:r.suborg_id,openingUnits:r.amount_units,planHash:r.plan_hash})))!==result.lateJoinsHash) throw Error('season_join_capture_incomplete');
        // No Points table, wallet, current-cycle pointer, token or mint record
        // is changed. Expired/stolen leases cannot publish a result.
        await sql`WITH held AS (
          SELECT c.cycle_id,c.plan_hash,c.plan,c.status FROM sepolia_tournament_cycles c
          JOIN sepolia_tournament_lock l ON l.owner_address=c.plan->'deployment'->>'operations'
          WHERE c.cycle_id=${result.cycleId} AND l.lease_token=${lease} AND l.lease_until>now() FOR UPDATE
        ) INSERT INTO sepolia_tournament_closures(cycle_id,plan_hash,result_hash,result)
        SELECT cycle_id,plan_hash,${resultHash},${JSON.stringify(result)}::jsonb FROM held
        WHERE status='funded' AND plan_hash=${result.planHash}
          AND plan->'deployment'->>'token'=${result.token}
          AND (plan->>'endsAt')::timestamptz<=now()
          AND NOT EXISTS (SELECT 1 FROM sepolia_tournament_joins
            WHERE cycle_id=held.cycle_id AND status='prepared')
        ON CONFLICT(cycle_id) DO NOTHING`;
        const saved=await this.read(result.cycleId);
        if (!saved) throw Error('season_not_funded_ended_or_joins_pending');
        if (saved.resultHash!==resultHash) throw Error('season_result_is_immutable');
        return saved;
      } finally {
        await sql`UPDATE sepolia_tournament_lock SET lease_until=now()-interval '1 second'
          WHERE owner_address=${owner} AND lease_token=${lease}`;
      }
    },
  };
}
