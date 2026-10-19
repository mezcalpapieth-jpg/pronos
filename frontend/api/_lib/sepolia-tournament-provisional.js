import { planHash,seasonLateJoinsHash } from './sepolia-tournament.js';
import { buildSeasonScoreRows,validateSeasonContext,sepoliaSeasonRules } from './sepolia-tournament-final.js';

// A reviewed ongoing capture is a separate artifact. It cannot be passed to
// closing, change a frozen result or make anyone eligible for payment.
export function buildTournamentProvisionalScores({artifact,reviewedSnapshotHash,context,reviewedContextHash,now=new Date()}) {
  const {snapshotHash,...body}=artifact;
  if (artifact.version!==2 || artifact.mode!=='shadow' || artifact.readyForRewards!==false
    || snapshotHash!==reviewedSnapshotHash || snapshotHash!==planHash(body) || artifact.cutoffBoundary
    || artifact.registryHash!==planHash(artifact.registry)) throw Error('reviewed_ongoing_snapshot_required');
  const {plan,users,window}=validateSeasonContext(context,artifact.snapshot,reviewedContextHash);
  const asOf=artifact.snapshot.asOf,timestamp=Date.parse(asOf.timestamp),clock=new Date(now).getTime();
  if (!Number.isFinite(clock) || timestamp>clock || clock>=Date.parse(plan.endsAt)
    || timestamp<Date.parse(plan.startsAt) || timestamp>=Date.parse(plan.endsAt)) throw Error('ongoing_capture_required');
  const rows=buildSeasonScoreRows({artifact,context,plan,users,window,penaltyAt:asOf.timestamp});
  const rules=sepoliaSeasonRules(plan.allocationUnits);
  const result={version:1,mode:'provisional',status:'provisional',readyForRewards:false,
    cycleId:plan.cycleId,label:plan.label,planHash:planHash(plan),chainId:421614,token:plan.deployment.token,
    snapshotHash,contextHash:reviewedContextHash,registryHash:artifact.registryHash,
    lateJoinsHash:seasonLateJoinsHash(artifact.snapshot.lateRegistrations),
    window,asOf,rules,rulesHash:planHash(rules),totalParticipants:rows.length,rows};
  return {...result,resultHash:planHash(result)};
}

export function validateProvisionalResult(cycle,result) {
  const {resultHash,...body}=result,plan=cycle.plan;
  if (resultHash!==planHash(body) || result.version!==1 || result.mode!=='provisional' || result.status!=='provisional'
    || result.readyForRewards!==false || result.cycleId!==plan.cycleId || result.planHash!==cycle.plan_hash
    || result.chainId!==421614 || result.token!==plan.deployment.token || result.window?.startsAt!==plan.startsAt
    || result.window?.rankingCutoffAt!==plan.endsAt || result.rulesHash!==planHash(sepoliaSeasonRules(plan.allocationUnits))
    || planHash(result.rules)!==result.rulesHash || !Number.isSafeInteger(result.asOf?.blockNumber) || result.asOf.blockNumber<1
    || !/^0x[0-9a-f]{64}$/.test(result.asOf.blockHash||'') || !Number.isFinite(Date.parse(result.asOf.timestamp))
    || Date.parse(result.asOf.timestamp)<Date.parse(plan.startsAt) || Date.parse(result.asOf.timestamp)>=Date.parse(plan.endsAt)
    || !Array.isArray(result.rows) || result.rows.length!==result.totalParticipants) throw Error('invalid_provisional_result');
  return result;
}

export async function verifyProvisionalAnchor(result,provider) {
  if ((await provider.getNetwork()).chainId!==421614) throw Error('rpc_chain_mismatch');
  const [tip,block]=await Promise.all([provider.getBlockNumber(),provider.getBlock(result.asOf.blockNumber)]);
  if (!block || tip<=result.asOf.blockNumber || block.hash?.toLowerCase()!==result.asOf.blockHash
    || new Date(block.timestamp*1000).toISOString()!==result.asOf.timestamp) throw Error('provisional_anchor_reorg_or_unconfirmed');
}
