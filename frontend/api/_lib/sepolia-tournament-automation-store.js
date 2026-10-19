import { randomUUID } from 'node:crypto';
import { planHash } from './sepolia-tournament.js';

const rows=r=>Array.isArray(r)?r:r.rows;
export const SEPOLIA_TOURNAMENT_AUTOMATION_SCHEMA=[
  `CREATE TABLE IF NOT EXISTS sepolia_standings_jobs (
    cycle_id text PRIMARY KEY REFERENCES sepolia_tournament_cycles(cycle_id),
    owner uuid NOT NULL, expires_at timestamptz NOT NULL,
    input jsonb, next_run_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending', updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sepolia_standings_checkpoints (
    cycle_id text NOT NULL REFERENCES sepolia_tournament_cycles(cycle_id),
    capture_id text NOT NULL CHECK(length(capture_id)=64), key text NOT NULL,
    payload jsonb NOT NULL, PRIMARY KEY(cycle_id,capture_id,key)
  )`,
  `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sepolia_standings_checkpoint_immutable') THEN
    CREATE TRIGGER sepolia_standings_checkpoint_immutable BEFORE UPDATE ON sepolia_standings_checkpoints
    FOR EACH ROW EXECUTE FUNCTION sepolia_tournament_frozen_result(); END IF; END $$`,
];

// One lease spans input selection, durable capture and publication. Each write
// is fenced in SQL, including checkpoint creation after an RPC response.
export function standingsAutomationStore(sql,cycleId) {
  const owner=randomUUID();
  const requireHeld=r=>{if(!rows(r).length)throw Error('standings_lease_lost');};
  return {
    async acquire() {
      const result=await sql`INSERT INTO sepolia_standings_jobs(cycle_id,owner,expires_at)
        VALUES(${cycleId},${owner},now()+interval '330 seconds')
        ON CONFLICT(cycle_id) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at
        WHERE sepolia_standings_jobs.expires_at<now() AND sepolia_standings_jobs.next_run_at<=now()
        RETURNING input`;
      return rows(result)[0] || null;
    },
    async assertHeld() {
      requireHeld(await sql`SELECT cycle_id FROM sepolia_standings_jobs
        WHERE cycle_id=${cycleId} AND owner=${owner} AND expires_at>now()`);
    },
    async saveInput(input) {
      requireHeld(await sql`UPDATE sepolia_standings_jobs SET input=${JSON.stringify(input)}::jsonb,updated_at=now()
        WHERE cycle_id=${cycleId} AND owner=${owner} AND expires_at>now() RETURNING cycle_id`);
      // Abandoned generations are disposable RPC cache, not published audit
      // results. Bound storage when late joins or reorgs force a fresh capture.
      await sql`DELETE FROM sepolia_standings_checkpoints WHERE cycle_id=${cycleId} AND capture_id<>${planHash(input)}
        AND EXISTS(SELECT 1 FROM sepolia_standings_jobs WHERE cycle_id=${cycleId} AND owner=${owner} AND expires_at>now())`;
    },
    async checkpoints(input) {
      const captureId=planHash(input);
      const [size]=rows(await sql`SELECT COALESCE(SUM(octet_length(payload::text)),0)::text AS bytes
        FROM sepolia_standings_checkpoints WHERE cycle_id=${cycleId} AND capture_id=${captureId}`);
      // Bound serverless memory. Larger reviewed captures remain supported by
      // the private file-backed operator workflow, never by partial publication.
      if(BigInt(size.bytes)>64n*1024n*1024n)throw Error('standings_checkpoint_size_limit');
      const saved=rows(await sql`SELECT key,payload FROM sepolia_standings_checkpoints
        WHERE cycle_id=${cycleId} AND capture_id=${captureId}`);
      const cache=new Map(saved.map(r=>[r.key,r.payload]));
      let bytes=Number(size.bytes);
      return {
        read:async key=>cache.get(key)||null,
        create:async(key,payload)=>{
          if(cache.has(key))throw Error('checkpoint_exists');
          bytes+=Buffer.byteLength(JSON.stringify(payload))*2;
          if(bytes>64*1024*1024)throw Error('standings_checkpoint_size_limit');
          const inserted=await sql`INSERT INTO sepolia_standings_checkpoints(cycle_id,capture_id,key,payload)
            SELECT cycle_id,${captureId},${key},${JSON.stringify(payload)}::jsonb FROM sepolia_standings_jobs
            WHERE cycle_id=${cycleId} AND owner=${owner} AND expires_at>now()
            RETURNING key`;
          requireHeld(inserted);cache.set(key,payload);
        },
      };
    },
    async finish(status,{complete=false,delaySeconds=0}={}) {
      if(!Number.isSafeInteger(delaySeconds)||delaySeconds<0||delaySeconds>3600)throw Error('invalid_standings_delay');
      requireHeld(await sql`UPDATE sepolia_standings_jobs SET status=${status},
        input=CASE WHEN ${complete} THEN NULL ELSE input END,
        next_run_at=now()+${delaySeconds}*interval '1 second',updated_at=now()
        WHERE cycle_id=${cycleId} AND owner=${owner} AND expires_at>now() RETURNING cycle_id`);
      if(complete)await sql`DELETE FROM sepolia_standings_checkpoints WHERE cycle_id=${cycleId}
        AND EXISTS(SELECT 1 FROM sepolia_standings_jobs WHERE cycle_id=${cycleId} AND owner=${owner} AND expires_at>now())`;
    },
    async release() {
      await sql`UPDATE sepolia_standings_jobs SET expires_at=now()-interval '1 second'
        WHERE cycle_id=${cycleId} AND owner=${owner}`;
    },
  };
}
