import { createHash, randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { onchainFeeData } from './onchain-fees.js';

export const tradeError = (code, status = 409) => Object.assign(new Error(code), { status });
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
};
export const tradePayloadHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function tradeRequestKey(req) {
  const header = req.headers?.['idempotency-key'], body = req.body?.requestId;
  if (header && body && header !== body) throw tradeError('idempotency_key_mismatch', 400);
  const key = header || body;
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw tradeError('idempotency_key_required', 400);
  return key;
}

const unsignedOf = tx => ethers.utils.serializeTransaction({ to: tx.to, nonce: tx.nonce,
  gasLimit: tx.gasLimit, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
  data: tx.data, value: tx.value, chainId: tx.chainId, type: tx.type, accessList: tx.accessList });
function verifySigned(tx, wallet) {
  const parsed = ethers.utils.parseTransaction(tx.signed_tx);
  if (parsed.from?.toLowerCase() !== wallet || parsed.chainId !== 421614
    || parsed.nonce !== Number(tx.nonce) || parsed.hash !== tx.tx_hash
    || unsignedOf(parsed) !== tx.unsigned_tx) throw tradeError('trade_signature_mismatch', 503);
}
function assertCall(tx, call, wallet) {
  const parsed = ethers.utils.parseTransaction(tx.unsigned_tx);
  if (call.from?.toLowerCase() !== wallet || parsed.to?.toLowerCase() !== call.to?.toLowerCase()
    || parsed.data !== call.data || !parsed.value.isZero() || parsed.chainId !== 421614) {
    throw tradeError('trade_plan_mismatch', 503);
  }
}
export function publicTradeRequest(entry, transactions = [], indexed = false) {
  const tx = transactions.find(t => t.step === 'trade') || transactions.at(-1);
  return { requestId: entry.request_key, action: entry.action, status: indexed ? 'indexed' : entry.status,
    txHash: tx?.tx_hash || null, blockNumber: tx?.receipt?.blockNumber || null,
    ...(entry.status === 'confirmed' ? { ok: true, result: entry.result, indexingStatus: indexed ? 'indexed' : 'pending' }
      : { ok: false, pending: !['reverted','rejected'].includes(entry.status),
        ...(entry.status === 'rejected' ? { error: entry.result.error } : {}),
        ...(entry.status === 'reverted' ? { error: 'tx_reverted' } : {}) }),
  };
}

// A single leased wallet may advance only one persisted nonce at a time. A
// signed or externally consumed nonce never becomes a fresh economic request.
export async function runDurableTrade({ store, provider, sign, wallet, suborg, key, action, payload,
  prepare, execute, validate, feeQuote = onchainFeeData, waitMs = 8000 }) {
  wallet = ethers.utils.getAddress(wallet).toLowerCase();
  let entry = await store.create({ id: randomUUID(), wallet, suborg, key, action,
    payload, hash: tradePayloadHash({ chainId: 421614, action, payload }) });
  if (entry.suborg_id !== suborg || entry.action !== action
    || entry.payload_hash !== tradePayloadHash({ chainId: 421614, action, payload })) {
    throw tradeError('idempotency_key_conflict');
  }
  const response = async (status, extra = {}) => ({ httpStatus: status,
    body: { ...publicTradeRequest(entry, await store.transactions(entry.id)), ...extra } });
  if (entry.status === 'confirmed') return response(200, entry.result);
  if (entry.status === 'reverted') return response(409, { error: 'tx_reverted' });
  if (entry.status === 'rejected') return response(entry.result.httpStatus, { error: entry.result.error });
  const token = randomUUID();
  if (!await store.acquire(wallet, token)) return response(202, { pending: true, error: 'trade_request_pending' });
  const fence = async () => {
    if (!await store.renew(wallet, token)) throw tradeError('trade_request_pending', 202);
  };
  const update = async change => {
    if (!await store.update(entry, token, change)) throw tradeError('trade_request_pending', 202);
    entry = { ...entry, ...change };
  };
  async function settle(tx) {
    if (tx.status === 'confirmed') return tx.receipt;
    if (tx.status === 'reverted') throw tradeError('tx_reverted');
    verifySigned(tx, wallet);
    let receipt = await provider.getTransactionReceipt(tx.tx_hash);
    if (!receipt) {
      const latest = await provider.getTransactionCount(wallet, 'latest');
      if (latest > Number(tx.nonce)) {
        // Receipt propagation can lag the nonce. Recheck before flagging an
        // external replacement; later retries may still reconcile this hash.
        receipt = await provider.getTransactionReceipt(tx.tx_hash);
        if (!receipt) {
          await store.settle(entry, token, tx, 'needs_reconciliation');
          throw tradeError('trade_nonce_conflict', 202);
        }
      }
    }
    if (!receipt) {
      await fence();
      try { await provider.sendTransaction(tx.signed_tx); } catch { /* Ambiguous: reconcile the exact saved hash. */ }
      try { receipt = await provider.waitForTransaction(tx.tx_hash, 1, waitMs); } catch { /* Pending, never a fresh nonce. */ }
    }
    if (!receipt) throw tradeError('trade_request_pending', 202);
    if (receipt.transactionHash?.toLowerCase() !== tx.tx_hash || ![0, 1].includes(receipt.status)
      || !Number.isSafeInteger(receipt.blockNumber)) throw tradeError('trade_receipt_invalid', 202);
    await fence();
    if (!await store.settle(entry, token, tx, receipt.status === 1 ? 'confirmed' : 'reverted', receipt)) {
      throw tradeError('trade_request_pending', 202);
    }
    if (receipt.status !== 1) throw tradeError('tx_reverted');
    return receipt;
  }
  try {
    // Read after acquiring: another request may have completed while we waited.
    entry = await store.find(wallet, key);
    if (entry.status === 'confirmed') return response(200, entry.result);
    if (entry.status === 'reverted') return response(409, { error: 'tx_reverted' });
    if (entry.status === 'rejected') return response(entry.result.httpStatus, { error: entry.result.error });
    if (Number((await provider.getNetwork()).chainId) !== 421614) throw tradeError('trade_wrong_chain', 503);
    const ownTransactions = await store.transactions(entry.id);
    const pending = await store.unsettled(wallet);
    if (pending && pending.request_id !== entry.id && !ownTransactions.some(t => t.step === 'trade' && t.status === 'confirmed')) {
      // Do not leave behind a second executable intent when a fresh client
      // lost the first request ID. The owner can discover/resume the original.
      if (!ownTransactions.length && !entry.plan) {
        await update({ status: 'rejected', result: { error: 'trade_wallet_busy', httpStatus: 409 } });
        return response(409, { error: 'trade_wallet_busy' });
      }
      if (pending.status === 'reserved') return response(202, { error: 'trade_wallet_busy', pending: true });
      try { await settle(pending); } catch (error) {
        if (error.message !== 'tx_reverted') return response(202, { error: 'trade_wallet_busy', pending: true });
      }
    }
    if (!entry.plan) await update({ status: 'validated', plan: await prepare({ ownerAddr: wallet, chainId: 421614 }) });
    const execution = {
      async send(call) {
        await fence();
        if (call.suborgId !== suborg || call.from?.toLowerCase() !== wallet) throw tradeError('trade_owner_mismatch', 403);
        let tx = (await store.transactions(entry.id)).find(t => t.step === call.step);
        if (!tx) {
          // Only new signatures recheck mutable eligibility. Existing signed
          // transactions must reconcile even after the market/season closes.
          await validate?.(entry.plan);
          const [latest, pendingNonce] = await Promise.all([
            provider.getTransactionCount(wallet, 'latest'), provider.getTransactionCount(wallet, 'pending'),
          ]);
          if (latest !== pendingNonce) throw tradeError('trade_wallet_busy', 202);
          const fees = await feeQuote(provider, 421614);
          const unsigned = ethers.utils.serializeTransaction({ to: call.to, nonce: latest,
            gasLimit: call.gasLimit || ethers.BigNumber.from(600000),
            maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            data: call.data, value: 0, chainId: 421614, type: 2 });
          await fence();
          try { tx = await store.reserve(entry, token, { step: call.step, nonce: latest, unsigned }); }
          catch (error) {
            // A lagging RPC may report an already recorded nonce. The DB is
            // authoritative: hold this intent rather than sign that nonce.
            if (error.code === '23505') throw tradeError('trade_request_pending', 202);
            throw error;
          }
          if (!tx) throw tradeError('trade_request_pending', 202);
        }
        assertCall(tx, call, wallet);
        if (tx.status === 'reserved') {
          await validate?.(entry.plan);
          const [latest, pendingNonce] = await Promise.all([
            provider.getTransactionCount(wallet, 'latest'), provider.getTransactionCount(wallet, 'pending'),
          ]);
          if (latest > Number(tx.nonce)) throw tradeError('trade_unsigned_nonce_consumed');
          if (latest !== Number(tx.nonce) || pendingNonce !== latest) throw tradeError('trade_wallet_busy', 202);
          const signed = await sign({ suborgId: suborg, signWithAddress: ethers.utils.getAddress(wallet), unsignedTx: tx.unsigned_tx });
          const hash = ethers.utils.keccak256(signed);
          verifySigned({ ...tx, signed_tx: signed, tx_hash: hash }, wallet);
          // Signer latency may outlive the lease: the old worker must never
          // persist/broadcast after a successor has acquired the wallet.
          tx = await store.sign(entry, token, tx, { signed, hash });
          if (!tx) throw tradeError('trade_request_pending', 202);
        }
        return settle(tx);
      },
    };
    // Bypass gas/allowance checks and mutable quote validation when recovering
    // a submitted economic transaction. Approval-only recovery uses the saved
    // plan, then revalidates eligibility before the still-unsigned trade.
    const replay = tx => {
      const parsed = ethers.utils.parseTransaction(tx.unsigned_tx);
      return execution.send({ suborgId: suborg, from: wallet, to: parsed.to, data: parsed.data, step: tx.step });
    };
    const transactions = await store.transactions(entry.id);
    for (const approval of transactions.filter(t => t.step !== 'trade' && t.status !== 'confirmed')) await replay(approval);
    const trade = transactions.find(t => t.step === 'trade');
    if (trade) execution.receipt = await execution.send({ suborgId: suborg, from: wallet,
      to: ethers.utils.parseTransaction(trade.unsigned_tx).to,
      data: ethers.utils.parseTransaction(trade.unsigned_tx).data, step: 'trade' });
    else await validate?.(entry.plan);
    const result = await execute(entry.plan, execution);
    await update({ status: 'confirmed', result });
    return response(200, result);
  } catch (error) {
    const transactions = await store.transactions(entry.id);
    const signed = transactions.some(t => t.signed_tx);
    const reverted = transactions.some(t => t.status === 'reverted');
    if (reverted) {
      await update({ status: 'reverted' });
      return response(409, { error: 'tx_reverted' });
    }
    if (error.status >= 400 && error.status < 500
      && !transactions.some(t => t.step === 'trade' && t.signed_tx)
      && !transactions.some(t => ['signed','needs_reconciliation'].includes(t.status))) {
      await fence();
      await store.discardUnsigned(entry, token);
      await update({ status: 'rejected', result: { error: error.message, httpStatus: error.status } });
      return response(error.status, { error: error.message });
    }
    if (error.status === 202 || signed || transactions.length) {
      await update({ status: error.message === 'trade_nonce_conflict' || transactions.some(t => t.status === 'confirmed' && t.step === 'trade')
        ? 'needs_reconciliation' : 'pending' });
      return response(202, { error: error.status === 202 ? error.message : 'trade_request_pending', pending: true });
    }
    throw error;
  } finally { await store.release(wallet, token); }
}
