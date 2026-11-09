import { randomUUID } from 'node:crypto';
import { parseAutoResolverJsonb, resolveAutoResolverCandidate } from './auto-resolver-core.js';
import { loadPublishedResolution, loadSettlementMarket, settlementSettings, settlementSigner, settleOnchainMarket,
  settlementQueueReviewHash, settlementSourceHash } from './onchain-admin-settlement.js';
import { previewResolutionPayouts } from './onchain-resolution-payouts.js';
import { pendingResolutionCriteria } from './points-pending-resolution-rules.js';
import { tradeError, tradePayloadHash } from './trade-requests.js';

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
async function resolutionCandidates(sql,env,cursor=null) {
  return await sql`SELECT p.id AS points_id,p.parent_id,p.amm_mode,
          m.id,m.question,m.start_time,m.end_time,m.resolver_type,m.resolver_config,m.outcomes,
          m.outcome_count,m.protocol_version,m.market_id,m.factory_address,m.sport,m.league,
          pm.source_data AS pending_source_data
        FROM protocol_markets m JOIN points_markets p ON p.chain_id=m.chain_id AND p.mode='onchain'
          AND LOWER(p.chain_address)=LOWER(m.pool_address) AND p.chain_market_id::text=m.market_id::text
        LEFT JOIN LATERAL (SELECT source_data FROM points_pending_markets WHERE approved_market_id=p.id ORDER BY id DESC LIMIT 1) pm ON true
        WHERE m.chain_id=421614 AND m.status='active' AND p.parent_id IS NULL
          AND LOWER(m.factory_address)=ANY(${settlementSettings(env).factories}::text[])
          AND m.end_time IS NOT NULL AND m.end_time<now()
        AND (${cursor?.endTime || null}::timestamptz IS NULL OR (m.end_time,m.id)>(${cursor?.endTime || null}::timestamptz,${cursor?.marketId || 0}))
        ORDER BY m.end_time,m.id LIMIT 25`;
}
function resolutionEvidenceUrl(cfg) {
  if (cfg.source === 'espn' && /^\d+$/.test(String(cfg.eventId))
    && /^[a-z-]+\/[a-z0-9.-]+$/i.test(cfg.leaguePath || '')) {
    return `https://site.api.espn.com/apis/site/v2/sports/${cfg.leaguePath}/summary?event=${cfg.eventId}`;
  }
  // Resolver request URLs can contain private provider tokens. Only surface
  // URLs explicitly identified in the market config as public evidence.
  try {
    const url = new URL(cfg.evidenceUrl || cfg.publicSourceUrl);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* No public source link. */ }
  return null;
}

export async function reviewSepoliaResolution({ sql, provider, env, marketId, decide, payoutPreview = previewResolutionPayouts }) {
  if (!resolverSettings(env).configured) throw tradeError('resolver_isolation_failed', 403);
  if (Number((await provider.getNetwork()).chainId) !== 421614) throw tradeError('resolver_wrong_chain', 503);
  const market = await loadSettlementMarket(sql, marketId, env);
  const published = await loadPublishedResolution(sql, marketId);
  const outcomes = parseAutoResolverJsonb(published.outcomes, []);
  if (!Array.isArray(outcomes) || outcomes.length !== Number(market.outcome_count)
    || outcomes.some(label => typeof label !== 'string' || !label.trim())) throw tradeError('settlement_invalid_outcomes', 409);
  if (market.protocol_version === 'v2' && tradePayloadHash(outcomes) !== tradePayloadHash(parseAutoResolverJsonb(market.outcomes, []))) {
    throw tradeError('settlement_invalid_outcomes', 409);
  }
  const candidate = {
    ...market, ...published, outcomes, id: market.protocol_id, market_id: market.contract_id,
    resolver_type: published.resolver_type || market.resolver_type,
    resolver_config: published.resolver_type ? published.resolver_config : market.resolver_config,
  };

  const [decision, estimate] = await Promise.all([
    inspectResolutionCandidate(candidate, { sql, decide }),
    payoutPreview({ market, provider, env }),
  ]);
  const cfg = parseAutoResolverJsonb(candidate.resolver_config, {}) || {};
  return {
    marketId, chainId: 421614, status: decision.status, outcomes,
    criteria: pendingResolutionCriteria(cfg, parseAutoResolverJsonb(published.pending_source_data, {})),
    suggestedOutcome: decision.input?.outcome ?? null,
    evidence: {
      provider: cfg.source || cfg.resolutionSource || candidate.resolver_type || null,
      url: resolutionEvidenceUrl(cfg),
      score: decision.evidence?.finalScore ?? null,
      observedAt: decision.evidence?.observedAt ?? null,
    },
    reviewHash: settlementQueueReviewHash(market, published),
    estimate,
  };
}
export async function inspectResolutionCandidate(m,{sql,decide=resolveAutoResolverCandidate,now=()=>Date.now(),timeoutMs=15000}={}) {
  if(!automaticResolutionSupported(m))return {marketId:Number(m.points_id),status:'manual',reason:'manual_resolution_required'};
  let timer;
  try {
    const decision=await Promise.race([decide(m,{sql}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('source_timeout')),timeoutMs);})]);
    const outcome=decision.winningIdx;
    if(!Number.isInteger(outcome)||outcome<0||outcome>=Number(m.outcome_count))throw Error('invalid_source_outcome');
    return {marketId:Number(m.points_id),status:'ready',input:{marketId:Number(m.points_id),action:'resolve',outcome,reason:'Scheduled verified source resolution'},
      key:`auto_${tradePayloadHash({marketId:m.id,factory:m.factory_address,contractId:String(m.market_id),outcome})}`,
      expectedSourceHash:settlementSourceHash(m),evidence:{resolverType:m.resolver_type,observedAt:new Date(now()).toISOString(),
        finalScore:decision.finalScore||null,resolverInfo:decision.resolverInfo||null}};
  }catch(error){return {marketId:Number(m.points_id),status:'deferred',reason:error.benign?'evidence_not_ready_or_review_required':'source_or_settlement_unavailable'};}
  finally{clearTimeout(timer);}
}
// Read-only inspection also works while scheduling is disabled. It never takes
// a signing lease, writes a run/request, or receives signer credentials.
export async function previewSepoliaResolutions({sql,provider,env,decide,now=()=>Date.now(),timeoutMs=15000}) {
  if(!resolverSettings(env).configured)throw Error('resolver_isolation_failed');
  if(Number((await provider.getNetwork()).chainId)!==421614)throw Error('resolver_wrong_chain');
  const candidates=await resolutionCandidates(sql,env),results=[],deadline=now()+60000;
  for(const m of candidates.slice(0,5)) {
    if(now()>=deadline)break;
    results.push(await inspectResolutionCandidate(m,{sql,decide,now,timeoutMs}));
  }
  return {mode:'read_only',schedulingEnabled:resolverSettings(env).enabled,checked:results.length,truncated:candidates.length>results.length,
    candidates:results,transactionsSubmitted:0};
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
      const [last]=await sql`SELECT report->'cursor' AS cursor FROM sepolia_resolver_runs WHERE status='ok' AND report ? 'cursor' ORDER BY completed_at DESC LIMIT 1`;
      let candidates=await resolutionCandidates(sql,env,last?.cursor);
      if(!candidates.length && last?.cursor)candidates=await resolutionCandidates(sql,env);
      const seen = new Set();
      for (const m of candidates) {
        if (now()>=deadline || attempts>=3) break;
        if (seen.has(m.id)) continue;
        seen.add(m.id); report.checked++;
        report.cursor={endTime:new Date(m.end_time).toISOString(),marketId:Number(m.id)};
        const review=await inspectResolutionCandidate(m,{sql,decide,now});
        if(review.status!=='ready') {report.deferred.push({marketId:review.marketId,reason:review.reason});continue;}
        try {
          await submit(review.input,review.key,{expectedSourceHash:review.expectedSourceHash,evidence:review.evidence});
          if(report.pending.length)break;
        }catch {report.deferred.push({marketId:review.marketId,reason:'source_or_settlement_unavailable'});}

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
