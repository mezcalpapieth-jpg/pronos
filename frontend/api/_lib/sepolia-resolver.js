import { randomUUID } from 'node:crypto';
import { parseAutoResolverJsonb, resolveAutoResolverCandidate } from './auto-resolver-core.js';
import { settlementSettings, settlementSigner, settleOnchainMarket, settlementSourceHash } from './onchain-admin-settlement.js';
import { tradePayloadHash } from './trade-requests.js';

export const RESOLVER_MIGRATION = [
  `CREATE TABLE IF NOT EXISTS sepolia_resolver_lease (name text PRIMARY KEY CHECK(name='preview'), owner uuid NOT NULL, expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sepolia_resolver_runs (id uuid PRIMARY KEY, source_sha text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    status text NOT NULL CHECK(status IN ('running','ok','error')), report jsonb)`,
  `REVOKE ALL ON sepolia_resolver_lease, sepolia_resolver_runs FROM PUBLIC, pronos_reader, sepolia_indexer, sepolia_standings`,
  `GRANT SELECT,INSERT,UPDATE ON sepolia_resolver_lease, sepolia_resolver_runs TO pronos_writer`,
];
export function resolverSettings(env) {
  return { enabled: env.ONCHAIN_RESOLVER_SCHEDULE_ENABLED === 'true',
    configured: settlementSettings(env).configured && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA || '') };
}
const parallel = cfg => cfg.shape === 'parallel' || Array.isArray(cfg.legs);
export function automaticResolutionSupported(m) {
  const cfg = parseAutoResolverJsonb(m.resolver_config, {});
  if (parallel(cfg) || m.parent_id || m.amm_mode === 'parallel') return false;
  if (m.resolver_type === 'sports_api') return ['espn','football-data','mlb-stats','next-opponent'].includes(cfg.source)
    && ['binary','draw3','total-goals-over'].includes(cfg.shape);
  // Transcript, chart, airport and other review-heavy products stay manual in
  // this initial scheduler. Adding a shared reader does not authorize automation.
  return ['chainlink_price','api_price','weather_api'].includes(m.resolver_type);
}
export async function runSepoliaResolver({ sql, provider, env, sign, now = () => Date.now(),
  decide = resolveAutoResolverCandidate, settle = settleOnchainMarket }) {
  const settings = resolverSettings(env);
  if (!settings.enabled) return { status: 'disabled' };
  if (!settings.configured) throw Error('resolver_isolation_failed');
  if (Number((await provider.getNetwork()).chainId) !== 421614) throw Error('resolver_wrong_chain');
  const signer = settlementSigner('resolve', env), id = randomUUID(), deadline = now()+180000;
  const lease = await sql`INSERT INTO sepolia_resolver_lease(name,owner,expires_at)
    VALUES('preview',${id}::uuid,now()+interval '330 seconds') ON CONFLICT(name) DO UPDATE
    SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE sepolia_resolver_lease.expires_at<=now() RETURNING owner`;
  if (!lease.length) return { status:'skipped',reason:'already_running' };
  const report = { checked:0, resolved:[], pending:[], deferred:[], errors:[] };
  const held = async () => (await sql`SELECT owner FROM sepolia_resolver_lease
    WHERE name='preview' AND owner=${id}::uuid AND expires_at>now()`).length === 1;
  let recorded = false, attempts = 0;
  try {
    await sql`INSERT INTO sepolia_resolver_runs(id,source_sha,status) VALUES(${id}::uuid,${env.VERCEL_GIT_COMMIT_SHA},'running')`;
    recorded = true;
    const pending = await sql`SELECT request_key,payload FROM sepolia_trade_requests
      WHERE chain_id=421614 AND wallet_address=${signer.wallet} AND suborg_id=${signer.suborg}
        AND action='admin_resolve' AND payload->>'origin'='scheduler'
        AND status IN ('created','validated','pending','needs_reconciliation') ORDER BY created_at LIMIT 3`;
    const submit = async (input,key,review = {}) => {
      if (now()>=deadline || !await held()) throw Error('resolver_lease_or_deadline');
      attempts++;
      const result = await settle({ sql,provider,env,input,key,sign,origin:'scheduler',actor:'scheduled-resolver',...review });
      const row = { marketId:input.marketId,requestId:key,txHash:result.body.txHash || null };
      if (result.httpStatus === 200) report.resolved.push(row);
      else if (result.httpStatus === 202) report.pending.push(row);
      else report.errors.push({ ...row,error:'settlement_rejected' });
      return result;
    };
    for (const r of pending) {
      const { origin,review,...input } = r.payload;
      await submit(input,r.request_key);
      // Do not create further intents while an existing signature is uncertain.
      if (report.pending.length) break;
    }
    if (!report.pending.length && attempts<3 && now()<deadline) {
      const candidates = await sql`SELECT p.id AS points_id,p.parent_id,p.amm_mode,
          m.id,m.question,m.start_time,m.end_time,m.resolver_type,m.resolver_config,m.outcomes,
          m.outcome_count,m.protocol_version,m.market_id,m.factory_address,m.sport,m.league,
          pm.source_data AS pending_source_data
        FROM protocol_markets m JOIN points_markets p ON p.chain_id=m.chain_id AND p.mode='onchain'
          AND LOWER(p.chain_address)=LOWER(m.pool_address) AND p.chain_market_id::text=m.market_id::text
        LEFT JOIN LATERAL (SELECT source_data FROM points_pending_markets WHERE approved_market_id=p.id ORDER BY id DESC LIMIT 1) pm ON true
        WHERE m.chain_id=421614 AND m.status='active' AND p.parent_id IS NULL
          AND LOWER(m.factory_address)=ANY(${settlementSettings(env).factories}::text[])
          AND m.end_time IS NOT NULL AND m.end_time<now()
        ORDER BY m.end_time,m.id LIMIT 25`;
      const seen = new Set();
      for (const m of candidates) {
        if (now()>=deadline || attempts>=3) break;
        if (seen.has(m.id)) continue;
        seen.add(m.id); report.checked++;
        if (!automaticResolutionSupported(m)) { report.deferred.push({marketId:m.points_id,reason:'manual_resolution_required'}); continue; }
        let timer;
        try {
          const decision = await Promise.race([decide(m,{sql}),new Promise((_,reject)=>{
            timer=setTimeout(()=>reject(Error('source_timeout')),15000);
          })]);
          const outcome = decision.winningIdx;
          if (!Number.isInteger(outcome) || outcome<0 || outcome>=Number(m.outcome_count)) throw Error('invalid_source_outcome');
          const input = { marketId:Number(m.points_id),action:'resolve',outcome,reason:'Scheduled verified source resolution' };
          const key = `auto_${tradePayloadHash({marketId:m.id,factory:m.factory_address,contractId:String(m.market_id),outcome})}`;
          await submit(input,key,{expectedSourceHash:settlementSourceHash(m),evidence:{
            resolverType:m.resolver_type,observedAt:new Date(now()).toISOString(),
            finalScore:decision.finalScore || null,resolverInfo:decision.resolverInfo || null}});
          if (report.pending.length) break;
        } catch (error) {
          report.deferred.push({marketId:m.points_id,reason:error.benign?'evidence_not_ready_or_review_required':'source_or_settlement_unavailable'});
        } finally { clearTimeout(timer); }
      }
    }
    await sql`UPDATE sepolia_resolver_runs SET status='ok',completed_at=now(),report=${JSON.stringify(report)}::jsonb WHERE id=${id}::uuid`;
    return { status:'ok',runId:id,...report };
  } catch {
    if (recorded) await sql`UPDATE sepolia_resolver_runs SET status='error',completed_at=now(),report='{"error":"resolver_failed"}'::jsonb WHERE id=${id}::uuid`.catch(()=>{});
    throw Error('resolver_failed');
  } finally {
    await sql`UPDATE sepolia_resolver_lease SET expires_at=now() WHERE name='preview' AND owner=${id}::uuid`.catch(()=>{});
  }
}
