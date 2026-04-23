/**
 * Turnkey delegated-signing policy helpers (M2).
 *
 * Goal: after a user authorizes ONE policy at signup (or first
 * on-chain action), the Pronos backend API key can sign their
 * on-chain trades transparently — zero wallet popups per trade.
 *
 * Policy scope (locked in /memory/onchain_turnkey_delegation.md):
 *   - Allowed selectors: buy / sell / redeem / MXNB.approve
 *   - Allowed contracts: MarketFactory + every Market it deploys
 *   - Daily cap: 200,000 MXNB per user (MXN-pegged; ~$10k USD)
 *   - Lifetime: 180 days, then re-auth via email OTP
 *   - Blocked: withdrawals to external wallets, policy mutation,
 *              key export, sub-org deletion
 *
 * M2 ships the scaffold end-to-end: DB persistence, consent modal,
 * authorize/revoke endpoints. The actual Turnkey `createPolicy`
 * call is GATED behind `TURNKEY_POLICIES_ENABLED` because we don't
 * have on-chain contracts on this branch yet — whitelisting empty
 * addresses would be meaningless. When M3 deploys contracts, we
 * flip the flag + populate `onchainConfig()` below, and every
 * piece of plumbing above it is already live.
 */

import { isTurnkeyConfigured } from './turnkey.js';

// ── Tunables (keep in sync with onchain_turnkey_delegation.md) ──────

export const DELEGATION_DAYS = 180;
export const DELEGATION_DAILY_CAP_MXNB = 200_000;

// When M3 adds real contracts, populate this map (via env vars or
// a deployed-contracts manifest). Keys are chain IDs; values are
// the contract addresses the policy will allow the backend key to
// call. Until this returns at least one address, POLICIES_ENABLED
// stays off and the Turnkey call is short-circuited.
function onchainConfig() {
  return {
    chainId: Number(process.env.ONCHAIN_CHAIN_ID || 0),
    marketFactory: process.env.ONCHAIN_MARKET_FACTORY_ADDRESS || null,
    mxnbToken: process.env.ONCHAIN_MXNB_ADDRESS || null,
  };
}

/**
 * Is the on-chain delegation path wired? False on this branch until
 * M3. Endpoints use this to decide whether to hit Turnkey or
 * record a "simulated" policy (stored in DB, flagged, no real
 * signing authority yet).
 */
export function isDelegationEnabled() {
  if (process.env.TURNKEY_POLICIES_ENABLED !== 'true') return false;
  if (!isTurnkeyConfigured()) return false;
  const cfg = onchainConfig();
  return Boolean(cfg.marketFactory && cfg.mxnbToken);
}

// ── Policy creation ────────────────────────────────────────────────

/**
 * Create a delegation policy on the user's Turnkey sub-organization.
 *
 * Until `isDelegationEnabled()` returns true, we DO NOT call Turnkey —
 * we return a simulated result so the UI flow, DB persistence, and
 * revoke flow can be tested end-to-end. When M3 flips the flag, the
 * Turnkey call replaces the `{ simulated: true }` branch below and
 * every caller downstream (endpoint, DB, UI) works unchanged.
 *
 * Params:
 *   suborgId   — Turnkey sub-org UUID (from points_users.turnkey_sub_org_id)
 *   backendApiPublicKey — the P-256 pubkey of our backend API key
 *                         (the one in TURNKEY_API_PUBLIC_KEY). The
 *                         policy scopes signing authority to this key.
 *
 * Returns { policyId, expiresAt, dailyCapMxnb, simulated }.
 */
export async function createDelegationPolicy({ suborgId, backendApiPublicKey }) {
  if (!suborgId) throw new Error('suborgId required');
  const expiresAt = new Date(Date.now() + DELEGATION_DAYS * 86_400_000);

  if (!isDelegationEnabled()) {
    // Simulated path — record intent, surface in UI, plumb everything
    // EXCEPT the actual signing authority. M3 replaces this branch
    // with the real createPolicy call.
    return {
      policyId: `simulated-${suborgId.slice(0, 8)}-${Date.now()}`,
      expiresAt: expiresAt.toISOString(),
      dailyCapMxnb: DELEGATION_DAILY_CAP_MXNB,
      simulated: true,
    };
  }

  // ── Real Turnkey path (wired at M3) ──────────────────────────────
  //
  // Pseudocode (exact method name + policy DSL to be confirmed
  // against @turnkey/sdk-server when M3 lands):
  //
  //   const client = turnkeyApi();
  //   const { policyId } = await client.createPolicy({
  //     organizationId: suborgId,
  //     policyName: 'pronos-delegation-v1',
  //     effect: 'EFFECT_ALLOW',
  //     consensus: `approvers.any(user, user.publicKey == '${backendApiPublicKey}')`,
  //     condition: buildPolicyCondition({
  //       selectors: ['0x...buy', '0x...sell', '0x...redeem', '0x095ea7b3'],
  //       allowedTargets: [marketFactory, mxnbToken],
  //       dailyCapMxnb: DELEGATION_DAILY_CAP_MXNB,
  //     }),
  //     notes: `Valid ${DELEGATION_DAYS} days`,
  //   });
  //   return { policyId, expiresAt: expiresAt.toISOString(),
  //            dailyCapMxnb: DELEGATION_DAILY_CAP_MXNB, simulated: false };
  //
  // The policy DSL details (exact field names, selector encoding) come
  // from Turnkey's docs — leaving as a clear TODO so the policy string
  // lands in one commit after we've tested it against a real sub-org.
  throw new Error('createDelegationPolicy: real path not wired yet (M3)');
}

/**
 * Revoke a previously-created policy. Same simulated/real split as
 * creation.
 */
export async function revokeDelegationPolicy({ suborgId, policyId }) {
  if (!suborgId || !policyId) throw new Error('suborgId + policyId required');
  if (!isDelegationEnabled() || String(policyId).startsWith('simulated-')) {
    return { revoked: true, simulated: true };
  }
  // TODO (M3): await turnkeyApi().deletePolicy({ organizationId: suborgId, policyId });
  throw new Error('revokeDelegationPolicy: real path not wired yet (M3)');
}

// ── Signing ────────────────────────────────────────────────────────

/**
 * Sign an unsigned EVM transaction on behalf of the user via the
 * backend API key, leaning on the delegation policy attached to
 * their sub-org.
 *
 * Not wired until M3 — exposed now so the buy/sell endpoints can
 * import + call it, failing loudly if the env flag is off. Keeps
 * us from shipping a half-live signing path.
 */
export async function signDelegatedTransaction({ suborgId, unsignedTx }) {
  if (!isDelegationEnabled()) {
    const err = new Error('delegation_not_enabled');
    err.status = 503;
    throw err;
  }
  if (!suborgId || !unsignedTx) throw new Error('suborgId + unsignedTx required');
  // TODO (M3):
  //   const client = turnkeyApi();
  //   const result = await client.signTransaction({
  //     organizationId: suborgId,
  //     signWith: /* user's wallet address on the sub-org */,
  //     type: 'TRANSACTION_TYPE_ETHEREUM',
  //     unsignedTransaction: unsignedTx,
  //   });
  //   return result.signedTransaction;
  throw new Error('signDelegatedTransaction: real path not wired yet (M3)');
}
