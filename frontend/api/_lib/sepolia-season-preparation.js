import {ethers} from 'ethers';
import {planHash} from './sepolia-tournament.js';
import {parseFixedUnits,formatFixedUnits} from './onchain-reset-plan.js';
import {sepoliaGasSettings} from './sepolia-gas-config.js';
import {automaticResolutionSupported} from './sepolia-resolver.js';
const fail=code=>{throw Error(code);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const wei=n=>{if(typeof n!=='string'||!/^(0|[1-9]\d*)$/.test(n))fail('invalid_season_gas_estimate');return BigInt(n);};
// This is a budget proposal, deliberately not a funding plan. It needs no
// deployed addresses, provider, database, signer, or current-cycle mutation.
export function buildSeasonPreparation(input) {
  const {cycleId,label,startsAt,endsAt,expectedParticipants,lateJoinCapacity=0,allocationMxnp='500',maxTotalMxnp,markets,gas}=input||{};
  if(!/^[a-z0-9][a-z0-9-]{2,63}$/.test(cycleId||'') || typeof label!=='string'||!label.trim())fail('season_identity_required');
  const start=Date.parse(startsAt),end=Date.parse(endsAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start || !/Z$/.test(startsAt)||!/Z$/.test(endsAt))fail('invalid_season_window');
  if(!integer(expectedParticipants,1,100000)||!integer(lateJoinCapacity,0,100000))fail('invalid_season_participant_budget');
  const allocation=BigInt(parseFixedUnits(allocationMxnp)),cap=BigInt(parseFixedUnits(maxTotalMxnp));
  if(allocation<=0n||cap<=0n||!Array.isArray(markets)||!markets.length||markets.length>10000)fail('invalid_season_token_budget');
  const keys=new Set(),reviewedMarkets=[];let liquidity=0n;
  for(const m of markets) {
    if(typeof m.key!=='string'||!m.key.trim()||keys.has(m.key))fail('duplicate_or_missing_season_market');keys.add(m.key);
    const seed=BigInt(parseFixedUnits(m.seedMxnp)),close=Date.parse(m.closesAt);
    if(seed<=0n||!Number.isFinite(close)||close<start||close>end||!/Z$/.test(m.closesAt))fail('invalid_season_market_budget');
    const automatic=automaticResolutionSupported(m),manualOwner=typeof m.manualOwner==='string'?m.manualOwner.trim():'';
    reviewedMarkets.push({key:m.key,seedUnits:String(seed),closesAt:new Date(close).toISOString(),
      resolution:automatic?'automatic':'manual',manualOwner:automatic?null:manualOwner||null,
      resolverHash:planHash([m.resolver_type||null,m.resolver_config||null])});liquidity+=seed;
  }
  reviewedMarkets.sort((a,b)=>a.key.localeCompare(b.key));
  const user=allocation*BigInt(expectedParticipants),late=allocation*BigInt(lateJoinCapacity),total=user+late+liquidity;
  if(total>cap)fail('season_issuance_cap_exceeded');
  const blockers=['fresh_token_factories_and_router_required','confirmed_wallet_snapshot_required','reviewed_standings_policy_required',
    'authorized_live_rehearsal_required','prize_terms_and_operator_review_required'];
  if(reviewedMarkets.some(m=>m.resolution==='manual'&&!m.manualOwner))blockers.push('manual_resolution_coverage_required');
  let gasEstimate=null;
  if(gas) {
    const {expectedActiveUsers,tradesPerActiveUser,measuredTradeWei,settlementWei,deploymentWei}=gas;
    if(!integer(expectedActiveUsers,0,expectedParticipants+lateJoinCapacity)||!integer(tradesPerActiveUser,0,100000))fail('invalid_season_gas_activity');
    const perTrade=wei(measuredTradeWei),settlement=wei(settlementWei),deployment=wei(deploymentWei);
    if(perTrade===0n && expectedActiveUsers*tradesPerActiveUser>0)fail('invalid_season_gas_estimate');
    const settings=sepoliaGasSettings({}),trading=BigInt(expectedActiveUsers)*BigInt(tradesPerActiveUser)*perTrade;
    gasEstimate={expectedActiveUsers,tradesPerActiveUser,measuredTradeWei,tradeGasWei:String(trading),settlementWei,deploymentWei,
      estimatedConsumptionWei:String(trading+settlement+deployment),estimatedConsumptionEth:ethers.utils.formatEther(String(trading+settlement+deployment)),
      starterWalletFloatWei:String(BigInt(expectedActiveUsers)*BigInt(settings.starterTarget.toString())),
      activeWalletFloatWei:String(BigInt(expectedActiveUsers)*BigInt(settings.target.toString())),
      funding:'on_demand_only',inactiveUsersFunded:0,assumptionsRequireReview:true};
  } else blockers.push('measured_gas_budget_required');
  const body={version:1,kind:'unprovisioned_season_draft',chainId:421614,cycleId,label:label.trim(),startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString(),
    strategy:'new_token_per_tournament',expectedParticipants,lateJoinCapacity,allocationUnits:String(allocation),userUnits:String(user),
    lateJoinReserveUnits:String(late),liquidityUnits:String(liquidity),totalUnits:String(total),capUnits:String(cap),
    totalMxnp:formatFixedUnits(String(total)),markets:reviewedMarkets,gasEstimate,blockers,readyToLaunch:false};
  return {...body,draftHash:planHash(body)};
}
export function verifySeasonPreparation(draft,reviewedHash) {
  const {draftHash,...body}=draft||{};
  if(!/^[a-f0-9]{64}$/.test(reviewedHash||'')||draftHash!==reviewedHash||planHash(body)!==reviewedHash||draft.kind!=='unprovisioned_season_draft')fail('reviewed_season_draft_required');
  return draft;
}
// Match the eventual, independently verified deployment/funding plan to the
// reviewed budget. Never treat the proposal itself as authority to mint.
export function assertPreparedSeasonPlan(draft,reviewedHash,plan) {
  verifySeasonPreparation(draft,reviewedHash);
  for(const k of ['cycleId','label','startsAt','endsAt','allocationUnits','liquidityUnits','totalUnits'])if(plan[k]!==draft[k])fail('season_funding_plan_differs_from_review');
  if(plan.userCount!==draft.expectedParticipants||plan.maxTotalUnits!==draft.capUnits||String(plan.lateJoinReserveUnits||'0')!==draft.lateJoinReserveUnits)fail('season_funding_plan_differs_from_review');
  return plan;
}
