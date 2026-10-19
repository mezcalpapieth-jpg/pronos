import { ethers } from 'ethers';
import { address } from './sepolia-tournament.js';

const fail = code => { throw Error(code); };
const share = new ethers.utils.Interface([
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
]);

// Refund events omit burn amounts. Recover them only from this pool's token
// burns in the same receipt, bounded by the preceding pool event. Preserve
// repeated-outcome order: proportional cost-basis rounding is sequential.
export function refundBurns({ receipt, log, market, shareToken, version }) {
  const user = address(log.parsed.args.user), stride = version==='V1'?2n:256n;
  const firstId = BigInt(market.marketId)*stride;
  const previous = receipt.logs.filter(l=>address(l.address)===market.pool && l.logIndex<log.logIndex)
    .reduce((last,l)=>Math.max(last,l.logIndex),-1);
  const burns = [];
  for (const entry of [...receipt.logs].sort((a,b)=>a.logIndex-b.logIndex)) {
    if (entry.logIndex<=previous || entry.logIndex>=log.logIndex || address(entry.address)!==shareToken) continue;
    let parsed;try { parsed=share.parseLog(entry); } catch { continue; }
    const a = parsed.args;
    if (address(a.operator)!==market.pool || address(a.from)!==user || a.to!==ethers.constants.AddressZero) continue;
    const ids = parsed.name==='TransferSingle'?[a.id]:a.ids;
    // ethers Result.values is the Array method; use the positional ABI field.
    const amounts = parsed.name==='TransferSingle'?[a.value]:a[4];
    if (ids.length!==amounts.length) fail('refund_burn_mismatch');
    for (let i=0;i<ids.length;i++) {
      const outcome = BigInt(ids[i].toString())-firstId;
      if (outcome<0n || outcome>=BigInt(market.outcomeCount) || !amounts[i].gt(0)) fail('refund_burn_mismatch');
      burns.push({outcomeIndex:Number(outcome),sharesUnits:amounts[i].toString()});
    }
  }
  if (!burns.length && !log.parsed.args.payout.isZero()) fail('refund_burns_missing');
  return burns;
}

// Validate every wallet's events, including unregistered wallets. One payout
// anywhere in a pool forbids later cancellation/correction in these contracts.
export function verifyPoolLifecycle(history, market, version) {
  let resolved=false,canceled=false,disputed=false,winner=null,paid=false,expectedResolution=null;
  const outcome = n => {
    const value=Number(n)-(version==='V1'?1:0);
    if (!Number.isInteger(value)||value<0||value>=market.outcomeCount) fail('invalid_lifecycle_outcome');
    return value;
  };
  for (const log of [...history].sort((a,b)=>a.blockNumber-b.blockNumber||a.logIndex-b.logIndex)) {
    const {name,args:a}=log.parsed;
    if (a.marketId && a.marketId.toString()!==market.marketId) fail('lifecycle_market_mismatch');
    if (expectedResolution && (name!=='MarketResolved' || log.transactionHash!==expectedResolution.txHash)) fail('correction_resolution_pair_missing');
    if (name==='MarketResolved') {
      if (canceled || (resolved && !expectedResolution)) fail('resolution_history_mismatch');
      const next=outcome(a.outcome);
      if (expectedResolution && next!==winner) fail('resolution_mark_mismatch');
      resolved=true;winner=next;expectedResolution=null;
    } else if (name==='ResolutionDisputeOpened') {
      if (!resolved||canceled||disputed||outcome(a.outcome)!==winner) fail('invalid_dispute_history');
      disputed=true;
    } else if (name==='ResolutionDisputeCleared') {
      if (!disputed||canceled||outcome(a.outcome)!==winner) fail('invalid_dispute_history');
      disputed=false;
    } else if (name==='MarketResolutionCorrected') {
      if (!resolved||!disputed||canceled||paid||outcome(a.oldOutcome)!==winner) fail('invalid_correction_history');
      winner=outcome(a.newOutcome);disputed=false;expectedResolution={txHash:log.transactionHash};
    } else if (name==='MarketCanceled') {
      if (canceled||paid||(resolved&&!disputed)) fail('invalid_cancellation_history');
      canceled=true;disputed=false;
    } else if (name==='CancelRefunded') {
      if (!canceled) fail('refund_before_cancellation');
    } else if (name==='WinningsRedeemed') {
      if (!resolved||canceled||disputed || (version==='V2'&&Number(a.outcomeIndex)!==winner)
        || !a.shares.gt(0)||!a.payout.eq(a.shares)) fail('invalid_redemption_history');
      paid=true;
    } else if (resolved||canceled) fail('trade_after_market_closed');
  }
  if (expectedResolution) fail('correction_resolution_pair_missing');
  if (disputed || market.disputed) fail('open_dispute_requires_review');
  if (canceled!==(market.status==='canceled') || resolved!==market.resolved) fail('resolution_history_mismatch');
  if (resolved && !canceled && winner!==market.winner) fail('resolution_mark_mismatch');
}
