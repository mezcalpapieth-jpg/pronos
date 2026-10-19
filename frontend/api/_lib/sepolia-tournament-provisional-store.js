import { randomUUID } from 'node:crypto';
import { planHash,seasonLateJoinsHash,validateTournamentPlan } from './sepolia-tournament.js';
import { validateProvisionalResult } from './sepolia-tournament-provisional.js';

const rowsOf=r=>Array.isArray(r)?r:r.rows;
// Explicit future-preview migration only. Append-only snapshots retain the
// publication audit trail; final closures always take precedence when reading.
export const SEPOLIA_TOURNAMENT_PROVISIONAL_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_standings (
    cycle_id text NOT NULL REFERENCES sepolia_tournament_cycles(cycle_id),
    as_of_block bigint NOT NULL CHECK(as_of_block>0),
    result_hash text NOT NULL UNIQUE CHECK(length(result_hash)=64),
    result jsonb NOT NULL,
    published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(cycle_id,as_of_block),
    CHECK(result->>'cycleId'=cycle_id AND result->>'resultHash'=result_hash),
    CHECK((result->'asOf'->>'blockNumber')::bigint=as_of_block),
    CHECK(result->>'status'='provisional' AND result->>'readyForRewards'='false')
  )`,
  `ALTER TABLE sepolia_tournament_standings ADD COLUMN IF NOT EXISTS policy_hash text`,
  `ALTER TABLE sepolia_tournament_standings ADD COLUMN IF NOT EXISTS source_sha text`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sepolia_tournament_standings_immutable') THEN
    CREATE TRIGGER sepolia_tournament_standings_immutable BEFORE UPDATE OR DELETE ON sepolia_tournament_standings
    FOR EACH ROW EXECUTE FUNCTION sepolia_tournament_frozen_result(); END IF; END $$`,
];

export function tournamentProvisionalStore(sql) {
  return {
    async read(cycleId) {
      return rowsOf(await sql`SELECT result FROM sepolia_tournament_standings WHERE cycle_id=${cycleId}
        ORDER BY as_of_block DESC LIMIT 1`)[0]?.result||null;
    },
    async publish(result,{policyHash=null,sourceSha=null}={}) {
      if((policyHash!==null || sourceSha!==null) && (!/^[a-f0-9]{64}$/.test(policyHash||'')
        || !/^[a-f0-9]{40}$/.test(sourceSha||'')))throw Error('invalid_publication_audit');
      const [cycle]=rowsOf(await sql`SELECT plan,plan_hash,status FROM sepolia_tournament_cycles WHERE cycle_id=${result.cycleId}`);
      if (!cycle || cycle.status!=='funded') throw Error('funded_season_required');
      validateTournamentPlan(cycle.plan);
      if (planHash(cycle.plan)!==cycle.plan_hash) throw Error('reviewed_funded_cycle_required');
      validateProvisionalResult(cycle,result);
      // Use the same lease as enrollment and final closing. An expired publisher
      // cannot overwrite or race a newer capture or a frozen final result.
      const lease=randomUUID();
      const [held]=rowsOf(await sql`INSERT INTO sepolia_tournament_lock(owner_address,lease_token,lease_until)
        SELECT plan->'deployment'->>'operations',${lease},now()+interval '60 seconds'
        FROM sepolia_tournament_cycles WHERE cycle_id=${result.cycleId} AND status='funded'
          AND plan_hash=${result.planHash} AND now()>=(plan->>'startsAt')::timestamptz
          AND now()<(plan->>'endsAt')::timestamptz
          AND ${result.asOf.timestamp}::timestamptz<=now()
        ON CONFLICT(owner_address) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
        WHERE sepolia_tournament_lock.lease_until<now() RETURNING owner_address`);
      if (!held) throw Error('season_not_active_or_funder_busy');
      try {
        const joins=rowsOf(await sql`SELECT tx_hash,username,wallet_address,suborg_id,amount_units::text,plan_hash,status
          FROM sepolia_tournament_joins WHERE cycle_id=${result.cycleId} AND status<>'reverted'`);
        if (joins.some(r=>r.status!=='confirmed') || seasonLateJoinsHash(joins.map(r=>({txHash:r.tx_hash,username:r.username,
          wallet:r.wallet_address,suborg:r.suborg_id,openingUnits:r.amount_units,planHash:r.plan_hash})))!==result.lateJoinsHash) {
          throw Error('provisional_join_capture_changed');
        }
        const prior=await this.read(result.cycleId);
        if (prior && (prior.asOf.blockNumber>result.asOf.blockNumber
          || Date.parse(prior.asOf.timestamp)>Date.parse(result.asOf.timestamp)
          || (prior.asOf.blockNumber===result.asOf.blockNumber && prior.resultHash!==result.resultHash))) throw Error('provisional_capture_not_newer');
        const saved=rowsOf(await sql`WITH held AS (
          SELECT c.cycle_id FROM sepolia_tournament_cycles c JOIN sepolia_tournament_lock l
            ON l.owner_address=c.plan->'deployment'->>'operations'
          WHERE c.cycle_id=${result.cycleId} AND c.status='funded' AND c.plan_hash=${result.planHash}
            AND l.lease_token=${lease} AND l.lease_until>now() AND now()<(c.plan->>'endsAt')::timestamptz
            AND NOT EXISTS(SELECT 1 FROM sepolia_tournament_closures WHERE cycle_id=c.cycle_id) FOR UPDATE OF l
        ) INSERT INTO sepolia_tournament_standings(cycle_id,as_of_block,result_hash,result,policy_hash,source_sha)
        SELECT cycle_id,${result.asOf.blockNumber},${result.resultHash},${JSON.stringify(result)}::jsonb,${policyHash},${sourceSha} FROM held
        ON CONFLICT(cycle_id,as_of_block) DO NOTHING RETURNING result_hash`);
        const latest=await this.read(result.cycleId);
        if (!saved.length) {
          const closed=rowsOf(await sql`SELECT cycle_id FROM sepolia_tournament_closures WHERE cycle_id=${result.cycleId}`);
          if (closed.length || !latest || latest.resultHash!==result.resultHash) throw Error('season_closed_or_publication_lease_lost');
          // An identical retry is allowed only while the lease is still ours.
          const live=rowsOf(await sql`SELECT owner_address FROM sepolia_tournament_lock
            WHERE owner_address=${held.owner_address} AND lease_token=${lease} AND lease_until>now()`);
          if (!live.length) throw Error('publication_lease_lost');
        }
        return latest;
      } finally {
        await sql`UPDATE sepolia_tournament_lock SET lease_until=now()-interval '1 second'
          WHERE owner_address=${held.owner_address} AND lease_token=${lease}`;
      }
    },
  };
}
