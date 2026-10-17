import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { verifyTradingRouter, poolTradingRoute, tradingFactories } from './trading-router.js';
import { delegationConfig, delegationPlan } from './trading-delegation-store.js';
import { verifyTradingPolicy } from './trading-delegation.js';
const a = n => `0x${n.repeat(40)}`;
const code = '0x60006000';
const env = { ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  ONCHAIN_TRADING_ROUTER_ADDRESS: a('1'), ONCHAIN_TRADING_ROUTER_CODE_HASH: ethers.utils.keccak256(code),
  ONCHAIN_MARKET_FACTORY_ADDRESS: a('2'), ONCHAIN_MARKET_FACTORY_V2_ADDRESS: a('3'),
  ONCHAIN_COLLATERAL_ADDRESS: a('4'), ONCHAIN_SHARE_TOKEN_ADDRESS: a('5'), ONCHAIN_SHARE_TOKEN_V2_ADDRESS: a('6'),
  ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS: a('7'), ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS: a('8'),
  ONCHAIN_LEGACY_SHARE_TOKEN_ADDRESS: a('9'), ONCHAIN_LEGACY_SHARE_TOKEN_V2_ADDRESS: a('a'),
  TURNKEY_API_PUBLIC_KEY: `02${'ab'.repeat(32)}` };
function fixture({ patch = {}, chain = 421614, runtime = code, binding = {}, poolFactory = a('2'), registered = true, bound = a('1') } = {}) {
  const getters = { VERSION: 1, factoryV1: a('2'), factoryV2: a('3'), collateral: a('4'), tokenV1: a('5'), tokenV2: a('6'), ...binding };
  return { env: { ...env, ...patch }, provider: { getNetwork: async () => ({ chainId: chain }), getCode: async () => runtime },
    contractAt: address => address === a('1') ? { ...Object.fromEntries(Object.entries(getters).map(([k,v]) => [k,async () => v])),
      marketRoute: async () => { if (!registered) throw Error('unregistered pool'); return { binary: poolFactory === a('2'), marketId: 0 }; } }
      : [a('2'), a('3')].includes(address) ? { tradingRouter: async () => bound } : { factory: async () => poolFactory } };
}
test('router is optional; configured routing requires preview, pinned code, chain and every immutable binding', async () => {
  assert.equal(await verifyTradingRouter(fixture({ patch: { ONCHAIN_TRADING_ROUTER_ADDRESS: '', ONCHAIN_TRADING_ROUTER_CODE_HASH: '' } })), null);
  const verified = await verifyTradingRouter(fixture());
  assert.deepEqual(verified.factories, [a('2'), a('3')]);
  for (const options of [
    { patch: { VERCEL_ENV: 'production' } }, { patch: { VERCEL_GIT_COMMIT_REF: 'pointbreak' } },
    { patch: { ONCHAIN_TRADING_ROUTER_CODE_HASH: '' } }, { patch: { ONCHAIN_TRADING_ROUTER_ADDRESS: a('0') } },
    { patch: { ONCHAIN_TRADING_ROUTER_ADDRESS: '' } },
    { chain: 84532 }, { runtime: '0x' }, { runtime: '0x1234' }, { binding: { VERSION: 2 } },
    ...['factoryV1','factoryV2','collateral','tokenV1','tokenV2'].map(k => ({ binding: { [k]: a('b') } })), { bound: a('b') },
  ]) await assert.rejects(verifyTradingRouter(fixture(options)), /trading_router_unverified/);
});
test('only registered router pools route; explicit legacy pools keep the exact-pool path', async () => {
  assert.equal((await poolTradingRoute(a('b'), fixture())).binary, true);
  assert.equal((await poolTradingRoute(a('b'), fixture({ poolFactory: a('3') }))).binary, false);
  assert.equal(await poolTradingRoute(a('b'), fixture({ poolFactory: a('7') })), null);
  await assert.rejects(poolTradingRoute(a('b'), fixture({ poolFactory: a('c') })), /unverified/);
  await assert.rejects(poolTradingRoute(a('b'), fixture({ registered: false })), /unregistered/);
  assert.equal(tradingFactories({ ...env, VERCEL_ENV: 'production' }).length, 2);
  assert.equal(tradingFactories(env).length, 4);
});
test('consent can precede all routed markets and its hash stays stable as future pools appear', async () => {
  const router = await verifyTradingRouter(fixture());
  const row = { wallet_address: a('f') };
  const legacy = { pool_address: a('b'), protocol_version: 'v1', factory_address: a('7') };
  const initial = delegationConfig(row, [legacy], router, env);
  const before = delegationPlan(initial);
  const future = delegationConfig(row, [legacy,
    { pool_address: a('c'), protocol_version: 'v1', factory_address: a('2') },
    { pool_address: a('d'), protocol_version: 'v2', factory_address: a('3') },
    { pool_address: a('e'), protocol_version: 'v2', factory_address: a('2') }, // wrong variant ignored
  ], router, env);
  assert.equal(before.scopeHash, delegationPlan(future).scopeHash);
  assert.deepEqual(before.pools, [{ address: a('b'), version: 'v1', shareToken: a('9') }]);
  assert.equal(future.pools.length, 3);
  assert.equal(verifyTradingPolicy(before.policy, future).scopeHash, before.scopeHash);
  assert.deepEqual(delegationPlan(delegationConfig(row, [], router, env)).pools, []);
  assert.equal(verifyTradingPolicy(before.policy, { ...future, router: null }), null);
  assert.equal(verifyTradingPolicy({ ...before.policy, condition: before.policy.condition + ' || true' }, future), null);
  assert.doesNotMatch(before.policy.condition, /0xa9059cbb|0x01a9812c.*0xcccc/);
});
