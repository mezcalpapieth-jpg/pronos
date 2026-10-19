import { planHash, seasonLateJoinsHash } from './sepolia-tournament.js';
import { buildTournamentShadowScores, tournamentRegistrations } from './sepolia-tournament-scoring.js';
import { buildConvictionBonusByUser, buildPenalty, compareTournamentRows, isTouchMarketRow } from './points-tournament-leaderboard.js';
import { mexicoDateKey, roundTournamentAmount, tournamentRulesPayload,
  TOURNAMENT_MIN_ENTRY_MXNP, TOURNAMENT_QUALIFYING_MARKETS } from './points-tournament-config.js';

const fail = code => { throw Error(code); };
const iso = value => {
  const n=typeof value==='number'?value:Date.parse(value);
  if (!Number.isFinite(n)) fail('invalid_season_date');
  return new Date(n).toISOString();
};
// Points' shared rules use decimal Numbers. Refuse amounts outside their exact
// integer-unit range rather than silently narrowing the chain's uint256 values.
const amount = value => {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value || '')) fail('integer_units_required');
  const n=BigInt(value);
  if (n>BigInt(Number.MAX_SAFE_INTEGER) || n< -BigInt(Number.MAX_SAFE_INTEGER)) fail('points_scoring_range_exceeded');
  return Number(n)/1_000_000;
};
const order = (a,b) => a.blockNumber-b.blockNumber || a.logIndex-b.logIndex || (a.itemIndex||0)-(b.itemIndex||0);

export function sepoliaSeasonRules(openingUnits) {
  const { startingBalance,minEntryMxnp,qualifyingMarkets,inactivityPenalty,convictionMultiplier }=tournamentRulesPayload();
  return { version:1, startingBalance:openingUnits?amount(openingUnits):startingBalance,
    minEntryMxnp,qualifyingMarkets,inactivityPenalty,convictionMultiplier,
    supported:['marketPnl','conviction','inactivity','qualification'],
    unsupported:['liquidityReward','parlayPnl','stockPnl','walletRewards'],
    externalTransfers:'exclude_incoming_proportional_outgoing', endExclusive:true };
}

// Metadata is a separate reviewed input: user creation times, exposure groups,
// and touch-market flags are Points facts that cannot be recovered from ERC logs.
export function validateSeasonContext(context, snapshot, reviewedHash) {
  const {plan,digest,users}=tournamentRegistrations(snapshot);
  if (context?.version!==1 || planHash(context)!==reviewedHash || context.cycleId!==plan.cycleId
    || context.planHash!==digest || !Array.isArray(context.users) || !Array.isArray(context.markets)) fail('reviewed_points_context_required');
  const window={startsAt:plan.startsAt,scoringStartsAt:iso(context.scoringStartsAt),
    operationCloseAt:iso(context.operationCloseAt),rankingCutoffAt:plan.endsAt};
  if (window.scoringStartsAt!==plan.startsAt || window.operationCloseAt!==plan.endsAt) fail('invalid_season_window');
  const names=new Set(), pools=new Set();
  for (const u of context.users) {
    const registered=users.find(r=>r.username===u.username);
    if (!registered || names.has(u.username) || Date.parse(iso(u.createdAt))>Date.parse(registered.timestamp || plan.startsAt)) fail('invalid_season_user');
    names.add(u.username);
  }
  for (const m of context.markets) {
    if (!snapshot.markets.some(r=>r.pool===m.pool) || pools.has(m.pool)
      || !Number.isSafeInteger(m.pointsMarketId) || m.pointsMarketId<1
      || !Number.isSafeInteger(m.exposureGroupId) || m.exposureGroupId<1
      || typeof m.touchMarket!=='boolean') fail('invalid_season_market');
    if (m.startsAt!=null) iso(m.startsAt);
    pools.add(m.pool);
  }
  if (names.size!==users.length || pools.size!==snapshot.markets.length
    || new Set(context.markets.map(m=>m.pointsMarketId)).size!==pools.size) fail('incomplete_points_context');
  return {plan,users,window};
}

export async function exportSeasonContext(artifact,sql) {
  const snapshot=artifact.snapshot,{plan,digest,users}=tournamentRegistrations(snapshot);
  const rows = result => Array.isArray(result)?result:result.rows;
  const accounts=rows(await sql`SELECT LOWER(username) AS username,created_at FROM points_users
    WHERE LOWER(username)=ANY(${users.map(u=>u.username)}::text[])`);
  const mappings=rows(await sql`SELECT LOWER(m.chain_address) AS pool,m.id AS points_market_id,
    COALESCE(m.parent_id,m.id) AS exposure_group_id,COALESCE(m.start_time,parent.start_time) AS market_start_time,
    COALESCE(m.resolver_config,parent.resolver_config) AS resolver_config,pm.source_data AS pending_source_data
    FROM points_markets m LEFT JOIN points_markets parent ON parent.id=m.parent_id
    LEFT JOIN points_pending_markets pm ON pm.approved_market_id=COALESCE(m.parent_id,m.id)
    WHERE m.mode='onchain' AND m.chain_id=421614 AND LOWER(m.chain_address)=ANY(${snapshot.markets.map(m=>m.pool)}::text[])`);
  const context={version:1,cycleId:plan.cycleId,planHash:digest,scoringStartsAt:plan.startsAt,operationCloseAt:plan.endsAt,
    users:accounts.map(r=>({username:r.username,createdAt:iso(r.created_at)})).sort((a,b)=>a.username.localeCompare(b.username)),
    markets:mappings.map(r=>({pool:r.pool,pointsMarketId:Number(r.points_market_id),exposureGroupId:Number(r.exposure_group_id),
      startsAt:r.market_start_time?iso(r.market_start_time):null,touchMarket:isTouchMarketRow(r)})).sort((a,b)=>a.pool.localeCompare(b.pool))};
  validateSeasonContext(context,snapshot,planHash(context));
  return context;
}

export function buildTournamentFinalScores({ artifact, reviewedSnapshotHash, context, reviewedContextHash, now=new Date() }) {
  const {snapshotHash,...body}=artifact;
  if (artifact.version!==3 || artifact.mode!=='shadow' || snapshotHash!==reviewedSnapshotHash
    || snapshotHash!==planHash(body) || !artifact.cutoffBoundary) fail('reviewed_final_snapshot_required');
  const snapshot=artifact.snapshot;
  const {plan,users,window}=validateSeasonContext(context,snapshot,reviewedContextHash);
  const end=Date.parse(plan.endsAt), next=artifact.cutoffBoundary.nextBlock;
  if (artifact.cutoffBoundary.endsAt!==plan.endsAt || Date.parse(iso(now))<end
    || Date.parse(snapshot.asOf.timestamp)>=end || next.blockNumber!==snapshot.asOf.blockNumber+1
    || Date.parse(iso(next.timestamp))<end || !/^0x[0-9a-f]{64}$/.test(next.blockHash||'')) fail('season_cutoff_not_final');
  if (!Array.isArray(artifact.lateJoinReferences)
    || new Set(artifact.lateJoinReferences.map(r=>r.txHash)).size!==artifact.lateJoinReferences.length
    || snapshot.lateRegistrations.some(r=>!artifact.lateJoinReferences.some(ref=>planHash(ref)===planHash({
      txHash:r.txHash,username:r.username,wallet:r.wallet,suborg:r.suborg,openingUnits:r.openingUnits,planHash:r.planHash,
    })))) fail('incomplete_late_join_references');
  const scores=buildTournamentShadowScores(snapshot);
  const observed=structuredClone(artifact.scores);
  if (observed.transferReconciliation?.historicalBalancesVerified!==true) fail('verified_transfer_capture_required');
  observed.transferReconciliation.historicalBalancesVerified=false;
  if (planHash(scores)!==planHash(observed)) fail('snapshot_score_mismatch');
  if (scores.transferReconciliation.policy!=='exclude_incoming_proportional_outgoing') fail('verified_transfer_capture_required');
  const metadata=new Map(context.markets.map(m=>[m.pool,m]));
  const markets=new Map(snapshot.markets.map(m=>[m.pool,m]));
  const owners=new Map(users.map(u=>[u.wallet,u]));
  const marketPnl=new Map(), activity=new Map(), trades=[];
  const updatePnl = (wallet,pool,delta) => {
    const key=`${owners.get(wallet).username}:${metadata.get(pool).exposureGroupId}`;
    marketPnl.set(key,(marketPnl.get(key)||0)+delta);
  };
  for (const p of scores.accountingPositions) updatePnl(p.wallet,p.pool,amount(p.valueUnits));
  const entries=[...scores.eligibleEvents.map(e=>({...e,removal:false})),
    ...scores.eligibleRemovals.map(e=>({...e,removal:true}))].sort(order);
  for (const [index,e] of entries.entries()) {
    const market=markets.get(e.pool), meta=metadata.get(e.pool), user=owners.get(e.wallet);
    const timestamp=e.removal ? null : Date.parse(iso(e.timestamp));
    if (!e.removal && (timestamp<Date.parse(window.scoringStartsAt)
      || (['buy','sell'].includes(e.side) && timestamp>=Date.parse(window.operationCloseAt)))) fail('trade_outside_season_window');
    if (!e.removal) updatePnl(e.wallet,e.pool,amount(e.collateralUnits)*(e.side==='buy'?-1:1));
    const state=activity.get(user.username)||{days:new Set(),markets:new Set(),actions:0,buys:0};
    if (!e.removal && ['buy','sell','redeem'].includes(e.side) && BigInt(e.sharesUnits)>0n) {
      state.days.add(mexicoDateKey(new Date(e.timestamp)));state.actions++;
      if (e.side==='buy') {
        state.buys++;
        if (amount(e.collateralUnits)>=TOURNAMENT_MIN_ENTRY_MXNP) state.markets.add(meta.exposureGroupId);
      }
    }
    activity.set(user.username,state);
    // Points retains winning lots through redemption. Outgoing share gifts must
    // consume conviction lots even when sent after resolution, without activity.
    trades.push({id:index,username:user.username,market_id:meta.pointsMarketId,exposure_group_id:meta.exposureGroupId,
      outcome_index:e.outcomeIndex??e.outcome,side:e.removal?'sell':e.side,
      shares:amount(e.sharesUnits),collateral:e.removal?0:amount(e.collateralUnits),tournament_featured:true,
      created_at:e.removal ? (trades.at(-1)?.created_at || plan.startsAt) : iso(e.timestamp),
      market_start_time:meta.startsAt?iso(meta.startsAt):plan.startsAt,market_end_time:iso(market.endsAt),
      market_status:market.status,market_outcome:market.winner,
      market_resolved_at:e.removal?null:market.resolvedAt,
      pending_source_data:{touchMarket:meta.touchMarket}});
  }
  const conviction=buildConvictionBonusByUser(trades,marketPnl,{window});
  const rows=scores.rows.map(row=>{
    const user=users.find(u=>u.username===row.username), meta=context.users.find(u=>u.username===row.username);
    const state=activity.get(row.username)||{days:new Set(),markets:new Set(),actions:0,buys:0};
    const effectiveStart=new Date(Math.max(Date.parse(meta.createdAt),Date.parse(user.timestamp||plan.startsAt))).toISOString();
    // Points counts the operation-close day inclusively. Convert the plan's
    // exclusive boundary to its last included instant before using that rule.
    const penalty=buildPenalty({user:{created_at:effectiveStart},activity:{active_day_keys:[...state.days]},now:new Date(plan.endsAt),
      window:{...window,operationCloseAt:new Date(end-1).toISOString()}});
    const pnl=amount(row.pnlUnits), bonus=conviction.bonusByUser.get(row.username)||0;
    const stats=conviction.statsByUser.get(row.username)||{};
    return {username:row.username,createdAt:meta.createdAt,balance:roundTournamentAmount(amount(row.actualCashUnits)),
      finalBalance:roundTournamentAmount(amount(row.equityUnits)),marketPnl:roundTournamentAmount(pnl),tradingPnl:roundTournamentAmount(pnl),
      currentPositionValue:roundTournamentAmount(amount(row.openValueUnits)),
      score:roundTournamentAmount(pnl+bonus-penalty.inactivityPenalty),cycleDelta:roundTournamentAmount(pnl+bonus-penalty.inactivityPenalty),
      holdBonus:roundTournamentAmount(bonus),convictionBonus:roundTournamentAmount(bonus),
      convictionBonusGross:roundTournamentAmount(stats.convictionBonusGross||0),
      convictionBonusCapApplied:roundTournamentAmount(stats.convictionBonusCapApplied||0),
      convictionEligibleProfit:roundTournamentAmount(stats.convictionEligibleProfit||0),
      convictionMarkets:stats.convictionMarkets||0,convictionLots:stats.convictionLots||0,
      ...penalty,qualifyingMarkets:state.markets.size,qualified:state.markets.size>=TOURNAMENT_QUALIFYING_MARKETS,
      totalActions:state.actions,buyCount:state.buys,liquidityReward:0,parlayPnl:0,parlayTickets:0,parlayWins:0,stockPnl:0};
  }).sort(compareTournamentRows).map((r,i)=>({...r,rank:i+1}));
  const rules=sepoliaSeasonRules(plan.allocationUnits);
  const result={version:1,mode:'final',status:'closed',readyForRewards:false,cycleId:plan.cycleId,label:plan.label,
    chainId:plan.deployment.chainId,token:plan.deployment.token,planHash:snapshot.reviewedPlanHash,
    snapshotHash,contextHash:reviewedContextHash,registryHash:artifact.registryHash,
    lateJoinsHash:seasonLateJoinsHash(artifact.lateJoinReferences),rulesHash:planHash(rules),rules,
    window,asOf:snapshot.asOf,cutoffBoundary:artifact.cutoffBoundary,totalParticipants:rows.length,rows};
  return {...result,resultHash:planHash(result)};
}

export async function verifySeasonCutoff(result, provider) {
  if ((await provider.getNetwork()).chainId!==421614) fail('rpc_chain_mismatch');
  const tip=await provider.getBlockNumber();
  for (const expected of [result.asOf,result.cutoffBoundary.nextBlock]) {
    const live=await provider.getBlock(expected.blockNumber);
    if (!live || tip<=expected.blockNumber || live.hash?.toLowerCase()!==expected.blockHash
      || new Date(live.timestamp*1000).toISOString()!==expected.timestamp) fail('season_cutoff_reorg_or_unconfirmed');
  }
}
