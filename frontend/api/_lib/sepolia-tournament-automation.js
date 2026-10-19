import { planHash,validateTournamentPlan } from './sepolia-tournament.js';
import { tournamentMarketRegistry } from './sepolia-tournament-snapshot.js';
import { captureTournamentSnapshot } from './sepolia-tournament-capture.js';
import { exportSeasonContext } from './sepolia-tournament-final.js';
import { buildTournamentProvisionalScores,verifyProvisionalAnchor } from './sepolia-tournament-provisional.js';
import { tournamentProvisionalStore } from './sepolia-tournament-provisional-store.js';
import { standingsAutomationStore } from './sepolia-tournament-automation-store.js';

const rows=r=>Array.isArray(r)?r:r.rows;
export function buildStandingsPolicy({registry,context,fromBlock,confirmations=12,reviewedRegistryHash,reviewedContextHash}) {
  const canonical=tournamentMarketRegistry(registry);
  if(planHash(canonical)!==reviewedRegistryHash || planHash(context)!==reviewedContextHash
    || context.version!==1 || context.cycleId!==canonical.cycleId || context.planHash!==canonical.planHash
    || !Array.isArray(context.markets) || context.markets.length!==canonical.markets.length
    || new Set(context.markets.map(m=>m.pool)).size!==canonical.markets.length
    || context.markets.some(m=>!canonical.markets.some(r=>r.pool===m.pool)))throw Error('reviewed_automation_context_required');
  const body={version:1,cycleId:canonical.cycleId,planHash:canonical.planHash,registry:canonical,
    registryHash:reviewedRegistryHash,marketsHash:planHash(context.markets),fromBlock,confirmations,intervalSeconds:300};
  const policy={...body,policyHash:planHash(body)};
  return validateStandingsPolicy(policy,policy.policyHash);
}
// A reviewed policy fixes the complete registry and the off-chain market rules.
// Account ages are read from the isolated Points database, including late joins.
export function validateStandingsPolicy(policy,reviewedHash) {
  if(policy?.version!==1 || policy.policyHash!==reviewedHash)throw Error('reviewed_standings_policy_required');
  const {policyHash,...body}=policy;
  if(policyHash!==planHash(body) || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(policy.cycleId||'')
    || !/^[a-f0-9]{64}$/.test(policy.planHash||'') || !/^[a-f0-9]{64}$/.test(policy.marketsHash||'')
    || !Number.isSafeInteger(policy.fromBlock) || policy.fromBlock<1
    || !Number.isSafeInteger(policy.confirmations) || policy.confirmations<2 || policy.confirmations>100
    || policy.intervalSeconds!==300 || policy.registryHash!==planHash(tournamentMarketRegistry(policy.registry))
    || policy.registry.cycleId!==policy.cycleId || policy.registry.planHash!==policy.planHash)throw Error('invalid_standings_policy');
  return policy;
}

export async function runStandingsTick({sql,provider,policy,reviewedPolicyHash,sourceSha,maxRequests=200,
  deadline=Date.now()+240_000,now=()=>new Date(),store=standingsAutomationStore(sql,policy?.cycleId),
  contextFor=exportSeasonContext}={}) {
  validateStandingsPolicy(policy,reviewedPolicyHash);
  if(!/^[a-f0-9]{40}$/.test(sourceSha||''))throw Error('reviewed_standings_source_required');
  if((await provider.getNetwork()).chainId!==421614)throw Error('rpc_chain_mismatch');
  const job=await store.acquire();
  if(!job)return {status:'skipped',reason:'busy_or_not_due'};
  try {
    const [cycle]=rows(await sql`SELECT plan,plan_hash,status FROM sepolia_tournament_cycles WHERE cycle_id=${policy.cycleId}`);
    if(!cycle || cycle.status!=='funded' || cycle.plan_hash!==policy.planHash || planHash(cycle.plan)!==policy.planHash)throw Error('reviewed_funded_cycle_required');
    validateTournamentPlan(cycle.plan);
    const closure=rows(await sql`SELECT cycle_id FROM sepolia_tournament_closures WHERE cycle_id=${policy.cycleId}`);
    const timestamp=new Date(now()).getTime();
    if(!Number.isFinite(timestamp))throw Error('invalid_standings_clock');
    if(closure.length || timestamp>=Date.parse(cycle.plan.endsAt)) {
      await store.finish('ended',{complete:true,delaySeconds:300});return {status:'ended'};
    }
    if(timestamp<Date.parse(cycle.plan.startsAt)) {
      await store.finish('scheduled',{complete:true,delaySeconds:300});return {status:'scheduled'};
    }
    const joins=rows(await sql`SELECT plan_hash,username,wallet_address,suborg_id,tx_hash,status
      FROM sepolia_tournament_joins WHERE cycle_id=${policy.cycleId} AND status<>'reverted' ORDER BY tx_hash`);
    if(joins.some(r=>r.status!=='confirmed')) {
      await store.finish('waiting_for_joins',{complete:true});return {status:'waiting_for_joins'};
    }
    const funding=rows(await sql`SELECT batch_index,tx_hash FROM sepolia_tournament_mints
      WHERE cycle_id=${policy.cycleId} AND status='confirmed' ORDER BY batch_index`)
      .map(r=>({batchIndex:Number(r.batch_index),txHash:r.tx_hash}));
    const lateJoins=joins.map(r=>({planHash:r.plan_hash,username:r.username,wallet:r.wallet_address,suborg:r.suborg_id,txHash:r.tx_hash}));
    const generation=planHash({policyHash:policy.policyHash,funding,lateJoins});
    let input=job.input;
    if(!input || input.generation!==generation) {
      const tip=await provider.getBlockNumber(),asOfBlock=tip-policy.confirmations+1;
      const anchor=await provider.getBlock(asOfBlock);
      if(!anchor || asOfBlock<policy.fromBlock || !Number.isSafeInteger(asOfBlock))throw Error('confirmed_standings_anchor_required');
      if(anchor.timestamp*1000<Date.parse(cycle.plan.startsAt)) {
        await store.finish('waiting_for_start',{complete:true});return {status:'waiting_for_start'};
      }
      input={generation,cycle,reviewedPlanHash:policy.planHash,registry:policy.registry,reviewedRegistryHash:policy.registryHash,
        fromBlock:policy.fromBlock,asOfBlock,expectedCutoffHash:anchor.hash,funding,lateJoins};
      await store.saveInput(input);
    }
    const assertDepth=async()=>{
      const tip=await provider.getBlockNumber();
      if(!Number.isSafeInteger(tip) || tip-input.asOfBlock<policy.confirmations-1)throw Error('standings_confirmation_depth_unavailable');
    };
    await assertDepth();
    const capture=await captureTournamentSnapshot(input,{provider,maxRequests,deadline,
      checkpointStore:await store.checkpoints(input),readIndexerCoverage:async factories=>rows(await sql`
        SELECT chain_id,factory_address,last_block FROM indexer_factory_state
        WHERE chain_id=421614 AND factory_address=ANY(${factories}::text[])`)
        .map(r=>({chainId:Number(r.chain_id),factory:r.factory_address,lastBlock:Number(r.last_block)}))});
    if(capture.status==='paused') {
      await store.finish('paused');return {status:'paused',newReads:capture.newReads,cacheHits:capture.cacheHits};
    }
    const artifact=capture.artifact,context=await contextFor(artifact,sql);
    if(planHash(context.markets)!==policy.marketsHash)throw Error('standings_market_context_changed');
    const result=buildTournamentProvisionalScores({artifact,context,reviewedSnapshotHash:artifact.snapshotHash,
      reviewedContextHash:planHash(context),now:now()});
    await verifyProvisionalAnchor(result,provider);
    await assertDepth();
    await store.assertHeld();
    await tournamentProvisionalStore(sql).publish(result,{policyHash:policy.policyHash,sourceSha});
    await store.finish('published',{complete:true,delaySeconds:policy.intervalSeconds});
    return {status:'published',cycleId:result.cycleId,resultHash:result.resultHash,asOfBlock:result.asOf.blockNumber};
  } catch(error) {
    // An observed reorg or changed roster needs a fresh canonical generation.
    // Other transient failures retain checkpoints for the next invocation.
    const reset=/reorg|join_capture_changed|not_newer|context_mismatch/.test(error.message);
    await store.finish('error',{complete:reset}).catch(()=>{});
    throw error;
  } finally {await store.release();}
}
