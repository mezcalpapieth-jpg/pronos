/**
 * On-chain trade dispatcher (M4).
 *
 * Wraps the three operations that need to hit the chain when a
 * market's `mode = 'onchain'`:
 *   - buyOnChain({suborgId, market, outcomeIndex, collateral, maxAvgPrice})
 *   - sellOnChain({suborgId, market, outcomeIndex, shares, minCollateralOut})
 *   - redeemOnChain({suborgId, market, outcomeIndex})
 *
 * Each call:
 *   1. Encodes the contract call via ethers.
 *   2. Builds an EIP-1559 unsigned tx (fetches nonce + gas prices
 *      from the configured RPC).
 *   3. Signs via Turnkey's delegated-signing API key (scope gated
 *      by the user's policy — see turnkey-delegation.js).
 *   4. Broadcasts — directly today, via paymaster in M5.
 *   5. Waits for 1-block confirmation.
 *   6. Returns a normalized result shape so the dispatch callers
 *      (buy.js / sell.js / redeem.js) can return the same payload
 *      they do today regardless of whether the market is
 *      points-mode or onchain-mode.
 *
 * Hard-gated: until `isOnchainReady()` returns true, every call
 * throws `onchain_not_enabled` with HTTP 503. Prevents a
 * half-configured deploy from silently failing mid-transaction.
 */

import { isDelegationEnabled, signDelegatedTransaction } from './turnkey-delegation.js';

/**
 * Everything needed to send an on-chain tx must be present:
 *   - delegation policies enabled (POLICIES_ENABLED + chain config)
 *   - RPC URL for the chain
 *   - Backend paymaster policy id (set to 'direct' to skip paymaster
 *     and have the user's wallet pay gas — testnet only)
 */
export function isOnchainReady() {
  if (!isDelegationEnabled()) return false;
  if (!process.env.ONCHAIN_RPC_URL) return false;
  return true;
}

/**
 * Shared gate used by every dispatch endpoint. Mirrors the existing
 * status-error pattern in buy.js so the main handler just re-throws.
 */
function requireOnchainReady() {
  if (!isOnchainReady()) {
    const err = new Error('onchain_not_enabled');
    err.status = 503;
    err.detail = 'on-chain trading requires TURNKEY_POLICIES_ENABLED=true, ONCHAIN_* env vars, and a delegation policy';
    throw err;
  }
}

// ── Buy ─────────────────────────────────────────────────────────────

/**
 * Execute an on-chain buy against the market's Market contract.
 * Mirrors buy.js's result shape:
 *   { balance, sharesOut, fee, priceBefore, priceAfter, txHash, blockNumber }
 *
 * Reserved but not wired — fully implemented once M5 lands paymaster
 * + deployed contracts. Until then this is the authoritative call
 * site that buy.js routes to for mode='onchain' markets, and it
 * bails cleanly rather than half-executing.
 */
export async function buyOnChain({ suborgId, market, outcomeIndex, collateral, maxAvgPrice }) {
  requireOnchainReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  // ── Build tx (M5 fills this in) ───────────────────────────────
  // const iface = new ethers.Interface(PRONOS_AMM_ABI);
  // const data  = iface.encodeFunctionData('buy', [outcomeIndex, collateral, maxSharesOutOr0]);
  // const provider = new ethers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
  // const from = userWalletAddressFromSuborg(suborgId);
  // const nonce = await provider.getTransactionCount(from);
  // const feeData = await provider.getFeeData();
  // const unsignedTx = ethers.Transaction.from({
  //   to: market.chain_address, value: 0n, data,
  //   nonce, chainId: Number(process.env.ONCHAIN_CHAIN_ID),
  //   gasLimit: 400_000n,
  //   maxFeePerGas: feeData.maxFeePerGas,
  //   maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
  //   type: 2,
  // }).unsignedSerialized;

  // ── Sign (already wired in M2, hard-gated) ────────────────────
  // const signed = await signDelegatedTransaction({ suborgId, unsignedTx });

  // ── Submit (paymaster in M5; direct broadcast fallback) ───────
  // const tx = await provider.broadcastTransaction(signed);
  // const receipt = await tx.wait();

  // ── Parse receipt, decode BuyExecuted event, return shape ─────
  // return { balance, sharesOut, fee, priceBefore, priceAfter,
  //          txHash: receipt.hash, blockNumber: receipt.blockNumber };
  throw new Error('buyOnChain: tx build + broadcast not wired yet (M5)');
}

// ── Sell ────────────────────────────────────────────────────────────

export async function sellOnChain({ suborgId, market, outcomeIndex, shares, minCollateralOut }) {
  requireOnchainReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!market?.chain_address) throw new Error('market missing chain_address');

  // Same shape as buyOnChain — encodeFunctionData('sell', [...]),
  // build tx, sign via delegation, broadcast, decode SellExecuted.
  // Returns { balance, collateralOut, sharesSold, realizedPnl,
  // priceBefore, priceAfter, txHash, blockNumber } to match sell.js.
  throw new Error('sellOnChain: tx build + broadcast not wired yet (M5)');
}

// ── Redeem ──────────────────────────────────────────────────────────

export async function redeemOnChain({ suborgId, market, outcomeIndex }) {
  requireOnchainReady();
  if (!suborgId) throw new Error('suborgId required');
  if (!market?.chain_address) throw new Error('market missing chain_address');
  // encodeFunctionData('redeem', [outcomeIndex]) — winner claims.
  // Emits Redeemed(user, marketId, amount). Returns { payout, txHash }.
  throw new Error('redeemOnChain: tx build + broadcast not wired yet (M5)');
}
