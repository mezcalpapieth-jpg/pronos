import { createHash } from 'node:crypto';
import { ethers } from 'ethers';

export const TRADING_POLICY_PREFIX = 'pronos-trading-v1-';
const address = value => {
  if (!/^0x[\da-f]{40}$/i.test(String(value))) throw delegationError('delegation_config_invalid', 503);
  return value.toLowerCase();
};
export const delegationError = (code, status = 409) => Object.assign(new Error(code), { status });

// Exact spender/operator calldata, guarded trading selectors, the owner's
// address, chain and gas bounds are all enforced by Turnkey, independently of DB.
export function buildTradingDelegation({ walletAddress, backendPublicKey, chainId, collateral, shares, pools }) {
  if (!/^(02|03)[\da-f]{64}$/i.test(backendPublicKey || '') || Number(chainId) !== 421614) {
    throw delegationError('delegation_config_invalid', 503);
  }
  const wallet = address(walletAddress);
  const token = address(collateral);
  const targets = [...new Map(pools.map(p => {
    if (!['v1', 'v2'].includes(p.version)) throw delegationError('delegation_config_invalid', 503);
    return [address(p.address), { address: address(p.address), version: p.version }];
  })).values()].sort((a, b) => a.address.localeCompare(b.address));
  if (!targets.length) throw delegationError('delegation_no_markets', 503);
  const erc20 = new ethers.utils.Interface(['function approve(address,uint256)']);
  const erc1155 = new ethers.utils.Interface(['function setApprovalForAll(address,bool)']);
  const calls = targets.flatMap(pool => [
    `(eth.tx.to == '${token}' && eth.tx.data == '${erc20.encodeFunctionData('approve', [pool.address, ethers.constants.MaxUint256]).toLowerCase()}')`,
    `(eth.tx.to == '${address(shares[pool.version])}' && eth.tx.data == '${erc1155.encodeFunctionData('setApprovalForAll', [pool.address, true]).toLowerCase()}')`,
    `(eth.tx.to == '${pool.address}' && eth.tx.data[0..10] in ${pool.version === 'v1' ? "['0x01a9812c','0xde254659','0xdb006a75']" : "['0xf6d956df','0x46280a80','0xdb006a75']"})`,
  ]);
  const condition = [
    "activity.type == 'ACTIVITY_TYPE_SIGN_TRANSACTION_V2'",
    "activity.params.type == 'TRANSACTION_TYPE_ETHEREUM'",
    `eth.tx.chain_id == ${Number(chainId)}`,
    `eth.tx.from == '${wallet}'`,
    'eth.tx.value == 0',
    'eth.tx.gas <= 600000',
    'eth.tx.max_fee_per_gas <= 200000000',
    `(${calls.join(' || ')})`,
  ].join(' && ');
  const consensus = `credentials.any(credential, credential.public_key == '${backendPublicKey}')`;
  const scopeHash = createHash('sha256').update(JSON.stringify({ condition, consensus })).digest('hex');
  return {
    scopeHash, pools: targets,
    policy: {
      policyName: `${TRADING_POLICY_PREFIX}${scopeHash.slice(0, 16)}`,
      effect: 'EFFECT_ALLOW', consensus, condition,
      // No time expression: remains authorized until the owner deletes it.
      notes: 'Owner-approved Pronos trading on Arbitrum Sepolia. No expiry. Exact market approvals, guarded buy/sell and redeem only. No withdrawals or account administration. No daily spending cap is claimed.',
    },
  };
}

export function inspectTradingSigner(snapshot, backendPublicKey) {
  if (!snapshot.quorum?.userIds?.length || !snapshot.quorum.threshold) throw delegationError('delegation_owner_unverified');
  const users = snapshot.users.filter(u => u.apiKeys?.some(k => k.credential?.publicKey === backendPublicKey));
  if (users.some(u => snapshot.quorum.userIds.includes(u.userId))) throw delegationError('delegation_backend_is_root');
  if (users.length > 1) throw delegationError('delegation_ambiguous_signer');
  const user = users[0];
  if (user && !user.apiKeys.some(k => k.credential?.publicKey === backendPublicKey && !k.expirationSeconds)) {
    throw delegationError('delegation_signer_expires');
  }
  return user?.userId || null;
}

export function managedPolicyIds(snapshot, consensus, recordedId) {
  return snapshot.policies.filter(p => p.consensus === consensus || p.policyId === recordedId).map(p => p.policyId);
}

export function verifyTradingPolicy(policy, config) {
  if (!policy || policy.time || policy.effect !== 'EFFECT_ALLOW') return null;
  // An older, still valid grant can cover fewer pools than today's full plan.
  // Rebuild it from trusted pool metadata and compare the entire expression.
  const pools = config.pools.filter(p => policy.condition?.includes(`eth.tx.to == '${p.address.toLowerCase()}' && eth.tx.data[0..10]`));
  if (!pools.length) return null;
  const expected = buildTradingDelegation({ ...config, pools });
  if (policy.policyName !== expected.policy.policyName || policy.condition !== expected.policy.condition || policy.consensus !== expected.policy.consensus) return null;
  return expected;
}
