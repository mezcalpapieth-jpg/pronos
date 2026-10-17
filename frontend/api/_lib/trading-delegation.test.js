import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradingDelegation, inspectTradingSigner, verifyTradingPolicy, managedPolicyIds } from './trading-delegation.js';
const a = n => `0x${String(n).repeat(40)}`;
const config = { walletAddress: a(1), backendPublicKey: `02${'ab'.repeat(32)}`, chainId: 421614,
  collateral: a(2), shares: { v1: a(3), v2: a(4) }, pools: [{ address: a(5), version: 'v1' }, { address: a(6), version: 'v2' }] };
const policy = buildTradingDelegation(config).policy;
const snapshot = { quorum: { threshold: 1, userIds: ['owner'] }, users: [{ userId: 'backend', apiKeys: [{ credential: { publicKey: config.backendPublicKey } }] }], policies: [{ ...policy, policyId: 'real' }] };

test('persistent grants enforce wallet, chain, zero value, gas caps and exact approvals', () => {
  assert.equal(policy.time, undefined);
  assert.match(policy.condition, /eth.tx.from == '0x111/);
  assert.match(policy.condition, /chain_id == 421614/);
  assert.match(policy.condition, /eth.tx.value == 0/);
  assert.match(policy.condition, /eth.tx.gas <= 600000/);
  assert.match(policy.condition, /max_fee_per_gas <= 200000000/);
  assert.match(policy.condition, /095ea7b30000000000000000000000005555/);
  assert.match(policy.condition, /a22cb4650000000000000000000000006666/);
  assert.doesNotMatch(policy.condition, /0xe24c469b|0xf571c5f3|0x62f791c0|0xd9515e0b/);
  assert.doesNotMatch(policy.condition, /0xa9059cbb/);
  assert.ok(verifyTradingPolicy(policy, config));
});

test('a new pool does not invalidate an existing grant for earlier markets', () => {
  const earlier = buildTradingDelegation({ ...config, pools: config.pools.slice(0, 1) });
  const verified = verifyTradingPolicy(earlier.policy, config);
  assert.equal(verified.pools.length, 1);
  assert.notEqual(verified.scopeHash, buildTradingDelegation(config).scopeHash);
});

test('tampered, expiring, broad, wrong-wallet and unknown-pool grants fail closed', () => {
  for (const edited of [
    { time: 'time.now < Timestamp(\'2099-01-01T00:00:00Z\')' },
    { condition: `${policy.condition} || true` }, { effect: 'EFFECT_DENY' },
    { consensus: 'true' }, { policyName: 'unverified' },
    { condition: policy.condition.replace(a(1), a(9)) },
    { condition: policy.condition.replaceAll(a(5), a(9)) },
  ]) assert.equal(verifyTradingPolicy({ ...policy, ...edited }, config), null);
});

test('root backend and expiring credentials are rejected, human root remains separate', () => {
  assert.equal(inspectTradingSigner(snapshot, config.backendPublicKey), 'backend');
  assert.throws(() => inspectTradingSigner({ ...snapshot, quorum: { threshold: 1, userIds: ['backend'] } }, config.backendPublicKey), /delegation_backend_is_root/);
  assert.throws(() => inspectTradingSigner({ ...snapshot, users: [{ userId: 'backend', apiKeys: [{ credential: { publicKey: config.backendPublicKey }, expirationSeconds: '3600' }] }] }, config.backendPublicKey), /delegation_signer_expires/);
  assert.deepEqual(managedPolicyIds({ ...snapshot, policies: [...snapshot.policies, { policyId: 'old' }] }, policy.consensus, 'old'), ['real', 'old']);
});
