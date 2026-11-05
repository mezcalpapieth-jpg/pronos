import { ethers } from 'ethers';
import { loadSettlementMarket, settlementSettings, settlementSigner, SETTLEMENT_LIMITS } from './onchain-admin-settlement.js';
import { runDurableTrade, tradeError, tradePayloadHash } from './trade-requests.js';
import { tradeRequestStore } from './trade-request-store.js';
import { onchainFeeData } from './onchain-fees.js';
import { pushCancelRefundsOnChain } from './onchain-trader.js';

export const REFUND_BATCH_SIZE = 5;
const addr = value => ethers.utils.getAddress(value).toLowerCase();
const bn = value => BigInt(value.toString());
const poolAbi = ['function canceled() view returns(bool)', 'function token() view returns(address)',
  'function collateral() view returns(address)', 'function costBasis(address,uint8) view returns(uint256)'];
const tokenAbi = ['function balanceOf(address,uint256) view returns(uint256)', 'function tokenId(uint256,uint8) view returns(uint256)',
  'function yesTokenId(uint256) view returns(uint256)', 'function noTokenId(uint256) view returns(uint256)'];
const refundEvents = new ethers.utils.Interface(['event CancelRefundPushed(uint256 indexed marketId,address indexed holder,uint256 payout)']);
export function refundInput(body) {
  const allowed = ['marketId','holders','operation','blockNumber','blockHash','planHash','reason','requestId'];
  if (!body || Object.keys(body).some(k=>!allowed.includes(k)) || !['preview','execute'].includes(body.operation)
    || !Number.isSafeInteger(body.marketId) || body.marketId<1) throw tradeError('invalid_refund_input',400);
  let holders;
  try { holders = body.holders?.map(addr).sort(); } catch { throw tradeError('invalid_refund_holders',400); }
  if (!holders?.length || holders.length>REFUND_BATCH_SIZE || new Set(holders).size!==holders.length
    || holders.includes(ethers.constants.AddressZero)) throw tradeError('invalid_refund_holders',400);
  const input={marketId:body.marketId,holders};
  if (body.operation==='execute') {
    if (!Number.isSafeInteger(body.blockNumber) || body.blockNumber<1 || !/^0x[\da-f]{64}$/.test(body.blockHash||'')
      || !/^[a-f0-9]{64}$/.test(body.planHash||'') || typeof body.reason!=='string' || !body.reason.trim() || body.reason.length>240) throw tradeError('invalid_refund_review',400);
    Object.assign(input,{blockNumber:body.blockNumber,blockHash:body.blockHash,planHash:body.planHash,reason:body.reason.trim()});
  }
  return input;
}
// All amounts come from a single canonical chain snapshot, never browser amounts
// or the derived positions table. Full balances burn the remaining native basis.
export async function previewCancelRefunds({sql,provider,env,input,contractAt=(a,abi)=>new ethers.Contract(a,abi,provider)}) {
  if (!settlementSettings(env).configured) throw tradeError('onchain_settlement_unavailable',503);
  if (Number((await provider.getNetwork()).chainId)!==421614) throw tradeError('settlement_wrong_chain',503);
  const market=await loadSettlementMarket(sql,input.marketId,env);
  if (market.status!=='canceled') throw tradeError('settlement_market_not_canceled');
  const count=Number(market.outcome_count);
  if (!Number.isInteger(count) || count<2 || count>8 || (market.protocol_version==='v1' && count!==2)) throw tradeError('settlement_invalid_outcomes');
  const block=await provider.getBlock(input.blockNumber ?? 'latest');
  if (!block?.hash || !Number.isSafeInteger(block.number) || (input.blockHash && input.blockHash!==block.hash.toLowerCase())) throw tradeError('settlement_refund_anchor_changed');
  const at={blockTag:block.number},pool=contractAt(market.pool_address,poolAbi);
  const factory=contractAt(market.factory_address,['function collateral() view returns(address)',
    `function getMarket(uint256) view returns(address,string,string,uint256,string,${market.protocol_version==='v2'?'uint8,':''}bool)`]);
  const [canceled,tokenAddress,collateral,chainMarket,factoryCollateral]=await Promise.all([
    pool.canceled(at),pool.token(at),pool.collateral(at),factory.getMarket(market.contract_id,at),factory.collateral(at)]);
  if (!canceled || addr(collateral)!==addr(env.ONCHAIN_COLLATERAL_ADDRESS) || addr(factoryCollateral)!==addr(collateral)
    || addr(chainMarket[0])!==addr(market.pool_address)) throw tradeError('settlement_contract_binding_mismatch');
  const token=contractAt(tokenAddress,tokenAbi),cash=contractAt(collateral,['function balanceOf(address) view returns(uint256)']);
  const ids=[];
  for(let i=0;i<count;i++) ids.push(market.protocol_version==='v2'?await token.tokenId(market.contract_id,i,at)
    :await token[i===0?'yesTokenId':'noTokenId'](market.contract_id,at));
  const refunds=[],skipped=[];
  for(const holder of input.holders) {
    if ([market.pool_address,market.factory_address,env.ONCHAIN_OWNER_ADDRESS,env.ONCHAIN_GAS_FUNDER_ADDRESS].filter(Boolean).some(a=>addr(a)===holder)) throw tradeError('invalid_refund_holder',400);
    const outcomeIndexes=[],amounts=[];let payout=0n;
    for(let i=0;i<count;i++) {
      const balance=bn(await token.balanceOf(holder,ids[i],at));
      if(balance>0n) {outcomeIndexes.push(i);amounts.push(String(balance));payout+=bn(await pool.costBasis(holder,i,at));}
    }
    if(payout>0n) refunds.push({holder,outcomeIndexes,amounts,payout:String(payout)});
    else skipped.push({holder,reason:amounts.length?'no_native_cost_basis':'no_open_shares'});
  }
  const payout=refunds.reduce((sum,r)=>sum+BigInt(r.payout),0n),balance=bn(await cash.balanceOf(market.pool_address,at));
  // Recheck the snapshot after the reads so a reorg cannot mix branches.
  if ((await provider.getBlock(block.number))?.hash?.toLowerCase()!==block.hash.toLowerCase()) throw tradeError('settlement_refund_anchor_changed');
  const body={version:1,marketId:input.marketId,protocolMarketId:Number(market.protocol_id),chainId:421614,
    factory:addr(market.factory_address),pool:addr(market.pool_address),contractId:String(market.contract_id),variant:market.protocol_version,
    blockNumber:block.number,blockHash:block.hash.toLowerCase(),holders:input.holders,refunds,skipped,
    payoutUnits:String(payout),poolBalanceUnits:String(balance),shortfallUnits:String(payout>balance?payout-balance:0n)};
  return {...body,planHash:tradePayloadHash(body)};
}
export function assertRefundReceipt(plan,receipt) {
  const actual=(receipt.logs||[]).flatMap(log=>{
    if(log.address?.toLowerCase()!==plan.factory)return [];
    try {const e=refundEvents.parseLog(log);return e.args.marketId.toString()===plan.contractId
      ?[{holder:e.args.holder.toLowerCase(),payout:e.args.payout.toString()}]:[];} catch{return [];}
  });
  if(receipt.status!==1 || tradePayloadHash(actual)!==tradePayloadHash(plan.refunds.map(r=>({holder:r.holder,payout:r.payout})))) throw tradeError('settlement_refund_receipt_requires_review',202);
}
export async function executeCancelRefunds({sql,provider,env,input,key,actor,sign,contractAt,
  preview=previewCancelRefunds,dispatch=pushCancelRefundsOnChain,runner=runDurableTrade}) {
  if(!settlementSettings(env).configured)throw tradeError('onchain_settlement_unavailable',503);
  const {wallet,suborg}=settlementSigner('cancel_refund',env);
  const read=i=>preview({sql,provider,env,input:i,contractAt});
  return runner({store:tradeRequestStore(sql),provider,sign,wallet,suborg,key,action:'admin_cancel_refund',payload:input,
    prepare:async()=>{
      const review=await read(input);
      if(review.planHash!==input.planHash)throw tradeError('settlement_refund_review_changed');
      if(!review.refunds.length)throw tradeError('settlement_no_refunds_due');
      if(BigInt(review.shortfallUnits)>0n)throw tradeError('settlement_refund_pool_shortfall');
      const gasLimit=250000+review.refunds.length*120000+review.refunds.reduce((sum,r)=>sum+r.amounts.length*35000,0),maxCostWei=String(BigInt(gasLimit)*BigInt(SETTLEMENT_LIMITS.maxFeePerGas));
      const [budget]=await sql`SELECT COALESCE(SUM((plan->>'maxCostWei')::numeric),0)::text AS used FROM sepolia_trade_requests
        WHERE chain_id=421614 AND wallet_address=${wallet} AND action LIKE 'admin_%' AND status<>'rejected'
        AND (updated_at>=now()-interval '24 hours' OR status IN ('validated','pending','needs_reconciliation'))`;
      if(BigInt(budget.used)+BigInt(maxCostWei)>BigInt(SETTLEMENT_LIMITS.walletDailyWei))throw tradeError('settlement_daily_budget_exceeded',429);
      return {review,actor,gasLimit,maxCostWei};
    },
    validate:async plan=>{
      const current=await read({marketId:input.marketId,holders:input.holders});
      const shape=r=>[r.factory,r.pool,r.contractId,r.variant,r.refunds,r.skipped];
      if(tradePayloadHash(shape(current))!==tradePayloadHash(shape(plan.review)))throw tradeError('settlement_refund_balances_changed');
      if(BigInt(current.shortfallUnits)>0n)throw tradeError('settlement_refund_pool_shortfall');
      const anchor=await provider.getBlock(input.blockNumber);
      if(anchor?.hash?.toLowerCase()!==input.blockHash)throw tradeError('settlement_refund_anchor_changed');
      if((await provider.getBalance(wallet)).lt(ethers.BigNumber.from(plan.maxCostWei).add(SETTLEMENT_LIMITS.reserveWei)))throw tradeError('settlement_signer_reserve_low',503);
    },
    feeQuote:async(p,chain)=>{
      const fees=await onchainFeeData(p,chain);
      if(!fees.maxFeePerGas || fees.maxFeePerGas.lte(0) || fees.maxFeePerGas.gt(SETTLEMENT_LIMITS.maxFeePerGas)
        || !fees.maxPriorityFeePerGas || fees.maxPriorityFeePerGas.gt(fees.maxFeePerGas))throw tradeError('settlement_fee_ceiling_exceeded',503);
      return fees;
    },
    execute:async(plan,execution)=>{
      if(execution.receipt)assertRefundReceipt(plan.review,execution.receipt);
      const checked={...execution,send:async call=>{const receipt=await execution.send(call);assertRefundReceipt(plan.review,receipt);return receipt;}};
      const r=await dispatch({ownerSuborgId:suborg,ownerAddr:wallet,factoryAddress:plan.review.factory,factoryVariant:plan.review.variant,
        marketId:plan.review.contractId,refunds:plan.review.refunds.map(r=>({...r,amounts:r.amounts.map(n=>ethers.utils.formatUnits(n,6)),payout:ethers.utils.formatUnits(r.payout,6)})),execution:checked});
      return {ok:true,marketId:input.marketId,action:'cancel_refund',txHash:r.txHash,blockNumber:r.blockNumber,
        refundCount:plan.review.refunds.length,payoutUnits:plan.review.payoutUnits,planHash:input.planHash,chainId:421614,indexingStatus:'pending',refundsPaid:true};
    }});
}
