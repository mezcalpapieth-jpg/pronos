import { ethers } from 'ethers';
import { pendingApprovalSettings } from './onchain-preview-approval.js';

export const TRADING_ROUTER_ABI = [
  'function VERSION() view returns(uint256)',
  'function factoryV1() view returns(address)', 'function factoryV2() view returns(address)',
  'function collateral() view returns(address)',
  'function tokenV1() view returns(address)', 'function tokenV2() view returns(address)',
  'function marketRoute(address) view returns(bool binary,uint256 marketId)',
  'function buy(address,uint8,uint256,uint256) returns(uint256)',
  'function sell(address,uint8,uint256,uint256) returns(uint256)',
  'function redeem(address,uint256)',
];
export const TRADING_ROUTER_SELECTORS = ['buy', 'sell', 'redeem'].map(name =>
  new ethers.utils.Interface(TRADING_ROUTER_ABI).getSighash(name));
const valid = value => /^0x[\da-f]{40}$/i.test(value || '') && !/^0x0{40}$/i.test(value);
const fail = () => { throw Object.assign(new Error('trading_router_unverified'), { status: 503 }); };

export function tradingFactories(env = process.env) {
  const current = [env.ONCHAIN_MARKET_FACTORY_ADDRESS, env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS];
  const legacy = pendingApprovalSettings(env).previewEnabled
    ? [env.ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS, env.ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS] : [];
  return [...new Set([...current, ...legacy].filter(valid).map(a => a.toLowerCase()))];
}

// An address alone is never enough to broaden a grant. Pin the reviewed runtime
// code and verify every immutable binding plus each factory's one-time binding.
export async function verifyTradingRouter({ env = process.env, provider, contractAt = (a, abi) => new ethers.Contract(a, abi, provider) } = {}) {
  if (!env.ONCHAIN_TRADING_ROUTER_ADDRESS && !env.ONCHAIN_TRADING_ROUTER_CODE_HASH) return null;
  if (!pendingApprovalSettings(env).previewEnabled || !valid(env.ONCHAIN_TRADING_ROUTER_ADDRESS)
    || !/^0x[\da-f]{64}$/i.test(env.ONCHAIN_TRADING_ROUTER_CODE_HASH || '')) fail();
  const expected = [env.ONCHAIN_MARKET_FACTORY_ADDRESS, env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS,
    env.ONCHAIN_COLLATERAL_ADDRESS, env.ONCHAIN_SHARE_TOKEN_ADDRESS, env.ONCHAIN_SHARE_TOKEN_V2_ADDRESS];
  if (!expected.every(valid)) fail();
  const address = env.ONCHAIN_TRADING_ROUTER_ADDRESS.toLowerCase();
  const router = contractAt(address, TRADING_ROUTER_ABI);
  const [network, code, version, ...bindings] = await Promise.all([
    provider.getNetwork(), provider.getCode(address), router.VERSION(), router.factoryV1(), router.factoryV2(),
    router.collateral(), router.tokenV1(), router.tokenV2(),
  ]);
  if (network.chainId !== 421614 || code === '0x' || Number(version) !== 1
    || ethers.utils.keccak256(code).toLowerCase() !== env.ONCHAIN_TRADING_ROUTER_CODE_HASH.toLowerCase()
    || bindings.some((a, i) => a.toLowerCase() !== expected[i].toLowerCase())) fail();
  const factories = bindings.slice(0, 2).map(a => a.toLowerCase());
  const bound = await Promise.all(factories.map(a => contractAt(a, ['function tradingRouter() view returns(address)']).tradingRouter()));
  if (bound.some(a => a.toLowerCase() !== address)) fail();
  return { address, factories, collateral: bindings[2].toLowerCase(),
    shares: { v1: bindings[3].toLowerCase(), v2: bindings[4].toLowerCase() } };
}

export async function poolTradingRoute(pool, { env = process.env, provider, contractAt = (a, abi) => new ethers.Contract(a, abi, provider) } = {}) {
  const router = await verifyTradingRouter({ env, provider, contractAt });
  if (!router) return null;
  const factory = (await contractAt(pool, ['function factory() view returns(address)']).factory()).toLowerCase();
  if (!router.factories.includes(factory)) {
    const legacy = [env.ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS, env.ONCHAIN_LEGACY_MARKET_FACTORY_V2_ADDRESS]
      .filter(valid).map(a => a.toLowerCase());
    if (legacy.includes(factory)) return null; // existing exact-pool grants only
    fail();
  }
  const result = await contractAt(router.address, TRADING_ROUTER_ABI).marketRoute(pool);
  return { ...router, binary: result.binary, marketId: result.marketId };
}
