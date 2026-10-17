import { isDelegationEnabled } from './turnkey-delegation.js';
import { pendingApprovalSettings } from './onchain-preview-approval.js';
import { readSuborgDelegation, authenticationCredentials } from './turnkey.js';
import { buildTradingDelegation, inspectTradingSigner, managedPolicyIds, delegationError } from './trading-delegation.js';

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
  const factoryV1 = String(process.env.ONCHAIN_MARKET_FACTORY_ADDRESS || '').toLowerCase();
  const factoryV2 = String(process.env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS || '').toLowerCase();
  // Include resolved markets: users must still be able to redeem later.
  // Never include pools from another chain/factory or silently truncate scope.
  const pools = await sql`
    SELECT pool_address, protocol_version FROM protocol_markets
    WHERE chain_id = 421614 AND pool_address IS NOT NULL
      AND ((protocol_version = 'v1' AND LOWER(factory_address) = ${factoryV1})
        OR (protocol_version = 'v2' AND LOWER(factory_address) = ${factoryV2}))
    ORDER BY pool_address
  `;
  const config = {
    walletAddress: row.wallet_address, backendPublicKey: process.env.TURNKEY_API_PUBLIC_KEY,
    chainId: 421614, collateral: process.env.ONCHAIN_COLLATERAL_ADDRESS || process.env.ONCHAIN_MXNB_ADDRESS,
    shares: { v1: process.env.ONCHAIN_SHARE_TOKEN_ADDRESS, v2: process.env.ONCHAIN_SHARE_TOKEN_V2_ADDRESS },
    pools: pools.map(p => ({ address: p.pool_address.toLowerCase(), version: p.protocol_version })),
  };
  const plan = buildTradingDelegation(config);
  return { ...identity, config, plan };
}
