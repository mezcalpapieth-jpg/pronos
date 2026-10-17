import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { GAS_CHAIN_ID, gasError, sepoliaGasSettings } from './sepolia-gas-config.js';
import { onchainFeeData } from './onchain-fees.js';

// Retries only ever rebroadcast the signature already persisted. An RPC
// timeout must not allocate another nonce or send a second top-up.
async function confirmTransfer(entry, { provider, store }) {
  const parsed = ethers.utils.parseTransaction(entry.signed_tx);
  if (parsed.hash !== entry.tx_hash || parsed.chainId !== GAS_CHAIN_ID
    || parsed.from?.toLowerCase() !== entry.funder_address || parsed.to?.toLowerCase() !== entry.wallet_address
    || !parsed.value.eq(entry.amount_wei) || parsed.data !== '0x') throw gasError();
  let receipt = await provider.getTransactionReceipt(entry.tx_hash);
  if (!receipt) {
    try { await provider.sendTransaction(entry.signed_tx); } catch {
      // Includes "already known" and ambiguous transport failures. Ask the
      // chain about this exact hash; never infer a failure from send's error.
    }
    try { receipt = await provider.waitForTransaction(entry.tx_hash, 1, 20_000); }
    catch { throw gasError('gas_funding_pending'); }
  }
  if (!receipt) throw gasError('gas_funding_pending');
  await store.settle(entry.tx_hash, receipt.status === 1 ? 'confirmed' : 'reverted');
  if (receipt.status !== 1) throw gasError();
}

export async function ensureSepoliaGas({ ownerAddr, suborgId, gasUnits, settings = sepoliaGasSettings(),
  provider, store, sign, authorize, feeQuote = onchainFeeData }) {
  if (!settings.enabled) return { funded: false, enabled: false };
  if (!settings.configured) throw gasError();
  const owner = ethers.utils.getAddress(ownerAddr).toLowerCase();
  if (!suborgId || owner === settings.funder || !Number.isSafeInteger(gasUnits) || gasUnits <= 0 || gasUnits > 720000) throw gasError();
  const [network, fees] = await Promise.all([provider.getNetwork(), feeQuote(provider, GAS_CHAIN_ID)]);
  if (network.chainId !== GAS_CHAIN_ID || !fees.maxFeePerGas?.gt(0)
    || fees.maxFeePerGas.gt(settings.maxFeePerGas)) throw gasError();
  const required = fees.maxFeePerGas.mul(gasUnits).mul(125).div(100);
  const minimum = required.gt(settings.minimum) ? required : settings.minimum;
  // Existing funded wallets can trade even if the funding DB/provider signer
  // is unavailable. No transfer or funding authorization is necessary here.
  if ((await provider.getBalance(owner)).gte(minimum)) return { funded: false, enabled: true };
  await authorize(); // Account, live owner grant and actual trade eligibility.
  if (await provider.getCode(owner) !== '0x') throw gasError();
  const token = randomUUID();
  if (!await store.acquire(settings.funder, token)) throw gasError('gas_funding_pending');
  try {
    const pending = await store.pending();
    if (pending) await confirmTransfer(pending, { provider, store });
    const balance = await provider.getBalance(owner);
    if (balance.gte(minimum)) return { funded: false, enabled: true };
    const value = settings.target.sub(balance);
    const [latestNonce, pendingNonce] = await Promise.all([
      provider.getTransactionCount(settings.funder, 'latest'), provider.getTransactionCount(settings.funder, 'pending'),
    ]);
    if (latestNonce !== pendingNonce) throw gasError('gas_funding_pending');
    const transaction = { from: settings.funder, to: owner, value, chainId: GAS_CHAIN_ID,
      type: 2, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas, data: '0x' };
    // Arbitrum estimates include its data cost; 21,000 alone is insufficient.
    const gasLimit = (await provider.estimateGas(transaction)).mul(130).div(100);
    if (gasLimit.gt(settings.transferGasCap)) throw gasError();
    const maxCost = value.add(gasLimit.mul(fees.maxFeePerGas));
    if ((await provider.getBalance(settings.funder)).lt(maxCost.add(settings.reserve))) throw gasError();
    const unsigned = ethers.utils.serializeTransaction({ ...transaction, from: undefined, nonce: latestNonce, gasLimit });
    const signed = await sign({ suborgId: settings.suborgId, signWithAddress: settings.funder, unsignedTx: unsigned });
    // Verify the signer returned precisely the requested transfer, not another
    // nonce, recipient, gas cap or chain. Only this persisted payload is sent.
    const parsed = ethers.utils.parseTransaction(signed);
    const returned = ethers.utils.serializeTransaction({ to: parsed.to, value: parsed.value, data: parsed.data,
      nonce: parsed.nonce, chainId: parsed.chainId, type: parsed.type, gasLimit: parsed.gasLimit,
      maxFeePerGas: parsed.maxFeePerGas, maxPriorityFeePerGas: parsed.maxPriorityFeePerGas, accessList: parsed.accessList });
    if (parsed.from?.toLowerCase() !== settings.funder || returned !== unsigned) throw gasError();
    const entry = { tx_hash: ethers.utils.keccak256(signed), signed_tx: signed, nonce: latestNonce,
      funder_address: settings.funder, wallet_address: owner, suborg_id: suborgId,
      signer_key_hash: settings.signerKeyHash,
      amount_wei: value.toString(), max_cost_wei: maxCost.toString() };
    if (!await store.prepare(entry, token, settings)) throw gasError('gas_funding_limit');
    await confirmTransfer(entry, { provider, store });
    return { funded: true, enabled: true, txHash: entry.tx_hash };
  } finally {
    await store.release(token);
  }
}
