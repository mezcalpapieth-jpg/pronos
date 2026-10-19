import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { address, planHash, validateTournamentPlan, TOURNAMENT_CHAIN_ID } from './sepolia-tournament.js';

export const JOIN_ABI = ['function transfer(address,uint256) returns(bool)',
  'event Transfer(address indexed from,address indexed to,uint256 value)'];
const token = new ethers.utils.Interface(JOIN_ABI);
const fail = code => { throw Error(code); };

export function verifyJoinReceipt(receipt, plan, join) {
  const transfers = receipt.logs.filter(l => l.address.toLowerCase() === plan.deployment.token)
    .flatMap(l => { try { return [token.parseLog(l)]; } catch { return []; } });
  if (transfers.length !== 1 || transfers[0].name !== 'Transfer'
    || address(transfers[0].args.from) !== plan.deployment.operations
    || address(transfers[0].args.to) !== join.wallet || transfers[0].args.value.toString() !== plan.allocationUnits) fail('join_transfer_mismatch');
}

function verifySaved(row, plan) {
  const tx = ethers.utils.parseTransaction(row.signed_tx);
  const expected = token.encodeFunctionData('transfer',[row.wallet_address,plan.allocationUnits]);
  if (tx.hash !== row.tx_hash || tx.chainId !== TOURNAMENT_CHAIN_ID || !tx.value.isZero()
    || address(tx.from) !== plan.deployment.operations || address(tx.to) !== plan.deployment.token
    || tx.nonce !== Number(row.nonce) || tx.data !== expected || row.plan_hash !== planHash(plan)
    || row.amount_units.toString() !== plan.allocationUnits) fail('saved_join_mismatch');
}

async function reconcile(row, plan, { provider, store }) {
  verifySaved(row,plan);
  const receipt = await provider.getTransactionReceipt(row.tx_hash);
  if (receipt) {
    if (receipt.transactionHash !== row.tx_hash) fail('join_receipt_mismatch');
    if (!Number.isSafeInteger(receipt.confirmations) || receipt.confirmations < 2) return { status:'pending', txHash:row.tx_hash };
    if ((await provider.getBlock(receipt.blockNumber)).hash !== receipt.blockHash) fail('join_receipt_reorg');
    if (receipt.status !== 1) {
      await store.settleJoin(row.tx_hash,'reverted');
      return { status:'reverted', txHash:row.tx_hash };
    }
    verifyJoinReceipt(receipt,plan,{wallet:row.wallet_address});
    await store.settleJoin(row.tx_hash,'confirmed');
    return { status:'registered', txHash:row.tx_hash };
  }
  if (await provider.getTransactionCount(plan.deployment.operations,'latest') > Number(row.nonce)) fail('join_nonce_consumed_without_receipt');
  try { await provider.sendTransaction(row.signed_tx); } catch { /* Only retry these persisted bytes. */ }
  return { status:'pending', txHash:row.tx_hash };
}

// A grant is transferred from a pre-minted, reviewed reserve. No mint authority
// is hosted, the opening plan stays immutable, and pending work is recoverable.
export async function joinTournament({ store, provider, cycleId, suborgId, sign, verifyRuntime,
  now = new Date() }) {
  const cycle = await store.cycle(cycleId), plan = validateTournamentPlan(cycle.plan);
  if (cycle.status !== 'funded' || plan.cycleId!==cycleId || cycle.plan_hash !== planHash(plan)) fail('funded_cycle_required');
  if ((await provider.getNetwork()).chainId !== TOURNAMENT_CHAIN_ID) fail('rpc_chain_mismatch');
  await verifyRuntime(plan);
  const user = await store.user(suborgId);
  user.wallet = address(user.wallet);
  const initial = plan.batches.flatMap(b=>b.recipients).filter(r=>r.kind==='user');
  const opening = initial.find(r=>r.username===user.username || r.wallet===user.wallet || r.suborg===user.suborg);
  if (opening) {
    if (opening.username!==user.username || opening.wallet!==user.wallet || opening.suborg!==user.suborg) fail('join_identity_changed');
    return {status:'registered',opening:true};
  }
  if (plan.lateJoining !== 'open_during_cycle') fail('late_joining_not_configured');
  if ([...Object.values(plan.deployment)].includes(user.wallet)) fail('recipient_is_system_address');
  const funder = plan.deployment.operations, lease = randomUUID();
  if (!await store.acquire(funder,lease)) fail('join_funder_busy');
  try {
    const pending = await store.pendingJoin(funder);
    if (pending) {
      if (pending.cycle_id !== cycleId) fail('another_cycle_has_pending_join');
      const result = await reconcile(pending,plan,{provider,store});
      if (pending.suborg_id===user.suborg || result.status!=='registered') return { ...result,
        ...(pending.suborg_id===user.suborg ? {} : {status:'pending'}) };
    }
    const existing = await store.join(cycleId,user);
    if (existing) {
      // Recheck the receipt on retries; a DB status alone cannot fund twice or
      // prove a reorged registration. Reverted receipts require a new attempt.
      const result = await reconcile(existing,plan,{provider,store});
      return result;
    }
    if (+now < Date.parse(plan.startsAt) || +now >= Date.parse(plan.endsAt)) fail('join_outside_cycle_window');
    if (await provider.getCode(user.wallet) !== '0x') fail('join_wallet_must_be_eoa');
    const [latest, next] = await Promise.all([provider.getTransactionCount(funder,'latest'),provider.getTransactionCount(funder,'pending')]);
    if (latest!==next) fail('join_funder_has_pending_transaction');
    const data = token.encodeFunctionData('transfer',[user.wallet,plan.allocationUnits]);
    // eth_call checks token balance and a non-reverting/true transfer without
    // actually changing the chain. Operations needs its own existing gas.
    const simulated = await provider.call({from:funder,to:plan.deployment.token,data});
    if (!token.decodeFunctionResult('transfer',simulated)[0]) fail('join_reserve_transfer_failed');
    const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
    const gasLimit = (await provider.estimateGas({from:funder,to:plan.deployment.token,data})).mul(130).div(100);
    if (gasPrice.mul(gasLimit).gt(ethers.utils.parseEther('0.001'))) fail('join_gas_budget_exceeded');
    const tx = {chainId:TOURNAMENT_CHAIN_ID,type:0,nonce:next,to:plan.deployment.token,value:0,data,gasPrice,gasLimit};
    const signed = await sign(tx,plan);
    const parsed = ethers.utils.parseTransaction(signed);
    if (address(parsed.from)!==funder || ethers.utils.serializeTransaction(tx)!==ethers.utils.serializeTransaction({
      chainId:parsed.chainId,type:parsed.type,nonce:parsed.nonce,to:parsed.to,value:parsed.value,
      data:parsed.data,gasPrice:parsed.gasPrice,gasLimit:parsed.gasLimit})) fail('join_signature_mismatch');
    const entry = {cycleId,planHash:cycle.plan_hash,...user,funder,nonce:next,units:plan.allocationUnits,signed,hash:parsed.hash};
    await store.prepareJoin(entry,lease);
    try { await provider.sendTransaction(signed); } catch { /* Persisted first; next request reconciles. */ }
    return {status:'pending',txHash:parsed.hash};
  } finally { await store.release(funder,lease); }
}
