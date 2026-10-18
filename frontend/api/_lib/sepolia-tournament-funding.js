import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { MINT_ABI, TOURNAMENT_CHAIN_ID, address, planHash, validateTournamentPlan, verifyTournamentDeployment } from './sepolia-tournament.js';

const mint = new ethers.utils.Interface(MINT_ABI);
const zero = ethers.constants.AddressZero;
const fail = message => { throw new Error(message); };

function verifySavedMint(pending, plan, batch) {
  const tx = ethers.utils.parseTransaction(pending.signed_tx);
  const expectedData = mint.encodeFunctionData('batchMint', [batch.recipients.map(r => r.wallet), batch.recipients.map(r => r.units)]);
  if (ethers.utils.keccak256(pending.signed_tx) !== pending.tx_hash || address(tx.from) !== plan.deployment.owner
    || tx.chainId !== TOURNAMENT_CHAIN_ID || address(tx.to) !== plan.deployment.token
    || tx.nonce !== Number(pending.nonce) || !tx.value.isZero() || tx.data !== expectedData) fail('saved_mint_payload_mismatch');
}

export function verifyMintReceipt(receipt, plan, batch) {
  const transfers = receipt.logs.filter(log => log.address.toLowerCase() === plan.deployment.token)
    .map(log => { try { return mint.parseLog(log); } catch { return null; } })
    .filter(log => log?.name === 'Transfer' && log.args.from === zero);
  if (transfers.length !== batch.recipients.length || transfers.some((log, i) =>
    address(log.args.to) !== batch.recipients[i].wallet || log.args.value.toString() !== batch.recipients[i].units)) fail('mint_receipt_allocation_mismatch');
}

// One bounded batch per invocation. A pending signature is always reconciled
// first, even if the cycle ended. Only the exact saved bytes are rebroadcast.
export async function fundTournamentBatch({ store, provider, cycleId, expectedHash, sign,
  now = new Date(), retryReverted = false, verifyDeployment = verifyTournamentDeployment }) {
  const cycle = await store.cycle(cycleId);
  const plan = validateTournamentPlan(cycle.plan);
  if (cycle.plan_hash !== expectedHash || planHash(plan) !== expectedHash) fail('reviewed_plan_hash_required');
  if ((await provider.getNetwork()).chainId !== TOURNAMENT_CHAIN_ID) fail('rpc_chain_mismatch');
  const owner = plan.deployment.owner;
  const lease = randomUUID();
  if (!await store.acquire(owner, lease)) fail('mint_owner_busy');
  try {
    const pending = await store.pending(owner);
    if (pending) {
      if (pending.cycle_id !== cycleId) fail('another_cycle_has_pending_mint');
      const batch = plan.batches[pending.batch_index];
      if (!batch || batch.units !== pending.amount_units.toString()) fail('pending_batch_mismatch');
      verifySavedMint(pending, plan, batch);
      const receipt = await provider.getTransactionReceipt(pending.tx_hash);
      if (receipt) {
        if (receipt.confirmations < 2) return { status: 'pending', txHash: pending.tx_hash };
        if (receipt.status !== 1) {
          await store.settle(pending.tx_hash, 'reverted');
          return { status: 'reverted', txHash: pending.tx_hash, retryRequiresReview: true };
        }
        verifyMintReceipt(receipt, plan, batch);
        await store.settle(pending.tx_hash, 'confirmed');
        return { status: 'confirmed', batchIndex: batch.index, txHash: pending.tx_hash };
      }
      // A missing receipt with a consumed nonce is ambiguous. Never replace it
      // with another mint or mark it successful from balances alone.
      if (await provider.getTransactionCount(owner, 'latest') > Number(pending.nonce)) fail('mint_nonce_consumed_without_receipt');
      try { await provider.sendTransaction(pending.signed_tx); } catch { fail('mint_broadcast_uncertain_resume_same_cycle'); }
      return { status: 'pending', txHash: pending.tx_hash };
    }
    const attempts = await store.attempts(cycleId);
    const confirmed = new Map(attempts.filter(a => a.status === 'confirmed').map(a => [Number(a.batch_index), a]));
    const confirmedUnits = [...confirmed.values()].reduce((sum, row) => sum + BigInt(row.amount_units), 0n);
    if (confirmedUnits > BigInt(plan.maxTotalUnits)) fail('cycle_issuance_cap_exceeded');
    if (cycle.status === 'funded') return { status: 'funded', totalUnits: confirmedUnits.toString() };
    // Includes zero-market checks: launch only after funding is final. A mint
    // outside this ledger stops the job instead of filling apparent balances.
    await verifyDeployment(plan, { provider, expectedSupply: confirmedUnits.toString() });
    const batch = plan.batches.find(b => !confirmed.has(b.index));
    if (!batch) {
      if (confirmedUnits.toString() !== plan.totalUnits) fail('cycle_total_mismatch');
      await store.finish(cycleId, lease, owner);
      return { status: 'funded', totalUnits: confirmedUnits.toString() };
    }
    if (new Date(plan.endsAt) <= now) fail('cycle_ended_no_new_mints');
    if (attempts.some(a => a.batch_index === batch.index && a.status === 'reverted') && !retryReverted) fail('reverted_batch_requires_explicit_retry');
    if (confirmedUnits + BigInt(batch.units) > BigInt(plan.totalUnits)) fail('cycle_total_exceeded');
    await store.verifyRecipients(batch);
    const [latest, next] = await Promise.all([
      provider.getTransactionCount(owner, 'latest'), provider.getTransactionCount(owner, 'pending')]);
    if (latest !== next) fail('mint_owner_has_other_pending_transaction');
    const data = mint.encodeFunctionData('batchMint', [batch.recipients.map(r => r.wallet), batch.recipients.map(r => r.units)]);
    const gasPrice = (await provider.getGasPrice()).mul(120).div(100);
    const gasLimit = (await provider.estimateGas({ from: owner, to: plan.deployment.token, data })).mul(130).div(100);
    // Hard guard, not a claim about expected costs. No ETH leaves for users.
    if (gasPrice.mul(gasLimit).gt(ethers.utils.parseEther('0.02'))) fail('batch_gas_budget_exceeded');
    if ((await provider.getBalance(owner)).lt(gasPrice.mul(gasLimit))) fail('mint_owner_needs_gas');
    const tx = { chainId: TOURNAMENT_CHAIN_ID, type: 0, nonce: next, to: plan.deployment.token,
      value: 0, data, gasPrice, gasLimit };
    const signed = await sign(tx);
    const decoded = ethers.utils.parseTransaction(signed);
    if (address(decoded.from) !== owner || ethers.utils.serializeTransaction(tx) !== ethers.utils.serializeTransaction({
      chainId: decoded.chainId, type: decoded.type, nonce: decoded.nonce, to: decoded.to,
      value: decoded.value, data: decoded.data, gasPrice: decoded.gasPrice, gasLimit: decoded.gasLimit })) fail('mint_signature_payload_mismatch');
    const hash = ethers.utils.keccak256(signed);
    await store.prepare({ cycleId, planHash: expectedHash, batchIndex: batch.index, owner, nonce: next,
      units: batch.units, signed, hash }, lease);
    try { await provider.sendTransaction(signed); } catch { fail('mint_broadcast_uncertain_resume_same_cycle'); }
    return { status: 'pending', batchIndex: batch.index, txHash: hash };
  } finally {
    await store.release(owner, lease);
  }
}
