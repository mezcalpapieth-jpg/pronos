import { randomUUID } from 'node:crypto';
import { planHash } from './sepolia-tournament.js';
import { buildRewardEligibility,exportRewardEvidence } from './sepolia-tournament-rewards.js';

const rows=r=>Array.isArray(r)?r:r.rows;
export const SEPOLIA_TOURNAMENT_REWARD_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS sepolia_tournament_eligibility (
    cycle_id text NOT NULL REFERENCES sepolia_tournament_closures(cycle_id),
    revision integer NOT NULL CHECK(revision>0), eligibility_hash text NOT NULL UNIQUE CHECK(length(eligibility_hash)=64),
    result_hash text NOT NULL, report jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(cycle_id,revision), CHECK(report->>'cycleId'=cycle_id AND report->>'resultHash'=result_hash),
    CHECK(report->>'eligibilityHash'=eligibility_hash AND report->>'readyForRewards'='false')
  )`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sepolia_tournament_eligibility_immutable') THEN
    CREATE TRIGGER sepolia_tournament_eligibility_immutable BEFORE UPDATE OR DELETE ON sepolia_tournament_eligibility
    FOR EACH ROW EXECUTE FUNCTION sepolia_tournament_frozen_result(); END IF; END $$`,
];
export function tournamentRewardStore(sql) {
  return {
    async read(cycleId) {
      return rows(await sql`SELECT report FROM sepolia_tournament_eligibility WHERE cycle_id=${cycleId}
        ORDER BY revision DESC LIMIT 1`)[0]?.report||null;
    },
    async publish(report) {
      const [cycle]=rows(await sql`SELECT c.plan,c.plan_hash,c.status,r.result FROM sepolia_tournament_cycles c
        JOIN sepolia_tournament_closures r USING(cycle_id) WHERE c.cycle_id=${report.cycleId}`);
      if(!cycle || cycle.status!=='funded' || planHash(cycle.plan)!==cycle.plan_hash)throw Error('frozen_reward_cycle_required');
      const rebuilt=buildRewardEligibility({cycle,result:cycle.result,evidence:report.evidence,review:report.review,
        reviewedResultHash:report.resultHash,reviewedEvidenceHash:report.evidenceHash,reviewedReviewHash:report.reviewHash});
      if(rebuilt.eligibilityHash!==report.eligibilityHash)throw Error('invalid_reward_report');
      const lease=randomUUID(),owner=cycle.plan.deployment.operations;
      const acquired=rows(await sql`INSERT INTO sepolia_tournament_lock(owner_address,lease_token,lease_until)
        VALUES(${owner},${lease},now()+interval '60 seconds')
        ON CONFLICT(owner_address) DO UPDATE SET lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until
        WHERE sepolia_tournament_lock.lease_until<now() RETURNING owner_address`);
      if(!acquired.length)throw Error('reward_review_busy');
      try {
        const prior=await this.read(report.cycleId);
        if(prior?.eligibilityHash===report.eligibilityHash)return prior;
        if((prior?.eligibilityHash||null)!==report.supersedes || (prior && Date.parse(report.reviewedAt)<Date.parse(prior.reviewedAt)))throw Error('reward_review_superseded');
        if(planHash(await exportRewardEvidence(cycle,cycle.result,sql))!==report.evidenceHash)throw Error('reward_evidence_changed');
        const inserted=rows(await sql`INSERT INTO sepolia_tournament_eligibility(cycle_id,revision,eligibility_hash,result_hash,report)
          SELECT ${report.cycleId},COALESCE((SELECT MAX(revision) FROM sepolia_tournament_eligibility WHERE cycle_id=${report.cycleId}),0)+1,
            ${report.eligibilityHash},${report.resultHash},${JSON.stringify(report)}::jsonb
          FROM sepolia_tournament_lock WHERE owner_address=${owner} AND lease_token=${lease} AND lease_until>now()
          RETURNING eligibility_hash`);
        if(!inserted.length)throw Error('reward_review_lease_lost');
        return report;
      } finally {
        await sql`UPDATE sepolia_tournament_lock SET lease_until=now()-interval '1 second'
          WHERE owner_address=${owner} AND lease_token=${lease}`;
      }
    },
  };
}
