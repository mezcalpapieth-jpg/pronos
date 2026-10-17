import { isDelegationEnabled } from './turnkey-delegation.js';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { readSuborgDelegation, authenticationCredentials } from './turnkey.js';
import { buildTradingDelegation, inspectTradingSigner, managedPolicyIds, delegationError } from './trading-delegation.js';
import { ethers } from 'ethers';
import { tradingFactories, verifyTradingRouter } from './trading-router.js';

export function delegationConfig(row, pools, router, env = process.env) {
  const current = { v1: env.ONCHAIN_MARKET_FACTORY_ADDRESS?.toLowerCase(), v2: env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS?.toLowerCase() };
  const legacy = { v1: env.ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS?.toLowerCase(), v2: env.ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS?.toLowerCase() };
  const legacyShares = { v1: env.ONCHAIN_LEGACY_SHARE_TOKEN_ADDRESS, v2: env.ONCHAIN_LEGACY_SHARE_TOKEN_V2_ADDRESS };
  const targets = pools.filter(p => ['v1', 'v2'].includes(p.protocol_version)
    && [current[p.protocol_version], legacy[p.protocol_version]].filter(Boolean).includes(p.factory_address.toLowerCase()))
    .map(p => ({ address: p.pool_address.toLowerCase(), version: p.protocol_version,
      routed: Boolean(router?.factories.includes(p.factory_address.toLowerCase())),
      ...(p.factory_address.toLowerCase() === legacy[p.protocol_version] ? { shareToken: legacyShares[p.protocol_version] || 'invalid' } : {}) }));
  return { walletAddress: row.wallet_address, backendPublicKey: env.TURNKEY_API_PUBLIC_KEY,
    chainId: 421614, collateral: env.ONCHAIN_COLLATERAL_ADDRESS || env.ONCHAIN_MXNB_ADDRESS,
    shares: { v1: env.ONCHAIN_SHARE_TOKEN_ADDRESS, v2: env.ONCHAIN_SHARE_TOKEN_V2_ADDRESS }, pools: targets, router };
}

export function delegationPlan(config) {
  return buildTradingDelegation({ ...config, pools: config.router ? config.pools.filter(p => !p.routed) : config.pools });
}

export async function loadTradingDelegationIdentity(sql, session) {
  if (!pendingApprovalSettings().previewEnabled || !isDelegationEnabled()) throw delegationError('delegation_not_enabled', 503);
  authenticationCredentials(process.env, { requireSeparate: true });
  const [row] = await sql`
    SELECT wallet_address, delegation_policy_id, delegation_expires_at, delegation_authorized_at
    FROM points_users WHERE turnkey_sub_org_id = ${session.sub} LIMIT 1
  `;
  if (!row?.wallet_address) throw delegationError('user_not_found', 404);
  const backendPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const snapshot = await readSuborgDelegation(session.sub);
  const backendUserId = inspectTradingSigner(snapshot, backendPublicKey);
  const consensus = `credentials.any(credential, credential.public_key == '${backendPublicKey}')`;
  const policyIds = managedPolicyIds(snapshot, consensus, row.delegation_policy_id);
  return { row, snapshot, backendUserId, policyIds };
}

export async function loadTradingDelegation(sql, session) {
  const identity = await loadTradingDelegationIdentity(sql, session);
  const { row } = identity;
  const factories = tradingFactories();
  const router = await verifyTradingRouter({ provider: new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL) });
  // Include resolved markets: users must still be able to redeem later.
  // Never include pools from another chain/factory or silently truncate scope.
  const pools = await sql`
    SELECT pool_address, protocol_version, factory_address FROM protocol_markets
    WHERE chain_id = 421614 AND pool_address IS NOT NULL
      AND LOWER(factory_address) = ANY(${factories}::text[])
    ORDER BY pool_address
  `;
  const config = delegationConfig(row, pools, router);
  const plan = delegationPlan(config);
  return { ...identity, config, plan };
}
