import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';
import { TRADING_ROUTER_ABI } from './trading-router.js';
const source = await readFile(new URL('./onchain-trader.js', import.meta.url), 'utf8');
const a = n => `0x${n.repeat(40)}`;
const router = { address: a('1'), binary: true, shares: { v1: a('2'), v2: a('3') } };
// Exercise actual dispatch, approval checks, ABI encoding and receipt parsing.
// Only RPC and signing transport are injected; no external wallet is used.
function fixture({ route = router, token = a('2'), failRoute = false } = {}) {
  const sent = [], allowances = new Map(), operators = new Set();
  const bindings = {
    ethers: { ...ethers, Contract: class {
      constructor(address) { return {
        token: async () => token,
        allowance: async (_owner, spender) => allowances.get(spender) || ethers.constants.Zero,
        isApprovedForAll: async (_owner, operator) => operators.has(`${address}:${operator}`),
      }; }
    } }, TRADING_ROUTER_ABI,
    process: { env: { ONCHAIN_COLLATERAL_ADDRESS: a('4') } },
    requireReady() {}, provider: () => ({}),
    poolTradingRoute: async () => { if (failRoute) throw Error('trading_router_unverified'); return route; },
    MAX_UINT256: ethers.constants.MaxUint256, COLLATERAL_DECIMALS: 6,
    async signAndBroadcast(tx) {
      sent.push(tx);
      const erc20 = new ethers.utils.Interface(['function approve(address,uint256)']);
      const erc1155 = new ethers.utils.Interface(['function setApprovalForAll(address,bool)']);
      if (tx.data.startsWith(erc20.getSighash('approve'))) {
        const [spender, amount] = erc20.decodeFunctionData('approve', tx.data); allowances.set(spender.toLowerCase(), amount);
      } else if (tx.data.startsWith(erc1155.getSighash('setApprovalForAll'))) {
        const [operator] = erc1155.decodeFunctionData('setApprovalForAll', tx.data); operators.add(`${tx.to}:${operator.toLowerCase()}`);
      }
      const multi = route?.binary === false;
      const abi = multi
        ? ['event SharesBought(address indexed buyer,uint8 indexed outcomeIndex,uint256 collateralIn,uint256 fee,uint256 sharesOut)', 'event SharesSold(address indexed seller,uint8 indexed outcomeIndex,uint256 sharesIn,uint256 collateralOut,uint256 fee)']
        : ['event SharesBought(address indexed buyer,bool isYes,uint256 collateralIn,uint256 fee,uint256 sharesOut)', 'event SharesSold(address indexed seller,bool isYes,uint256 sharesIn,uint256 collateralOut,uint256 fee)'];
      const iface = new ethers.utils.Interface(abi);
      return { transactionHash: 'synthetic', blockNumber: 1, logs: ['SharesBought','SharesSold'].map(name => ({
        address: a('a'), ...iface.encodeEventLog(iface.getEvent(name), [a('f'), multi ? 2 : true, 1000000, 10000, 2000000]),
      })) };
    },
  };
  const abis = source.slice(source.indexOf('const BINARY_AMM_ABI ='), source.indexOf('// MarketFactory ABIs'));
  const helpers = source.slice(source.indexOf('async function ensureCollateralAllowance('), source.indexOf('// ── Public API'));
  const trades = source.slice(source.indexOf('export async function buyOnChain('), source.indexOf('// ── Auto-deploy')).replaceAll('export async', 'async');
  const calls = new Function(...Object.keys(bindings), `${abis}\n${helpers}\n${trades}\nreturn { buyOnChain, sellOnChain, redeemOnChain };`)(...Object.values(bindings));
  const args = { suborgId: 'suborg', ownerAddr: a('f'), market: { chain_address: a('a'), outcomes: ['Yes','No'] }, outcomeIndex: 0,
    collateral: 1, minSharesOut: 0.5, shares: 1, minCollateralOut: 0.5, amount: 1 };
  return { ...calls, args, sent };
}
test('future pools reuse router collateral/operator approvals; all three calls target the router with guarded amounts', async () => {
  for (const binary of [true, false]) {
    const f = fixture({ route: { ...router, binary }, token: binary ? a('2') : a('3') });
    if (!binary) f.args.market.outcomes.push('Other');
    const iface = new ethers.utils.Interface(TRADING_ROUTER_ABI);
    assert.equal((await f.buyOnChain(f.args)).sharesOut, 2);
    await f.sellOnChain(f.args);
    f.args.market.chain_address = a('b');
    await f.buyOnChain(f.args); await f.sellOnChain(f.args); await f.redeemOnChain(f.args);
    assert.equal(f.sent.length, 7); // two approvals total for both pools
    const routed = f.sent.filter(tx => tx.to === router.address);
    assert.equal(routed.length, 5);
    const parsed = routed.map(tx => iface.parseTransaction(tx));
    assert.deepEqual(parsed.map(tx => tx.name), ['buy','sell','buy','sell','redeem']);
    assert.equal(parsed[2].args[0].toLowerCase(), a('b'));
    assert.equal(parsed[2].args[2].toString(), '1000000');
    assert.equal(parsed[2].args[3].toString(), '500000');
  }
});
test('unverified router, zero price protection and mismatched share tokens fail before approval/signing', async () => {
  const down = fixture({ failRoute: true });
  await assert.rejects(down.buyOnChain(down.args), /unverified/); assert.equal(down.sent.length, 0);
  const bad = fixture({ token: a('e') });
  await assert.rejects(bad.sellOnChain(bad.args), /invalid_router_trade/); assert.equal(bad.sent.length, 0);
  const unguarded = fixture();
  await assert.rejects(unguarded.buyOnChain({ ...unguarded.args, minSharesOut: 0 }), /invalid_router_trade/);
  await assert.rejects(unguarded.sellOnChain({ ...unguarded.args, minCollateralOut: null }), /invalid_router_trade/);
  assert.equal(unguarded.sent.length, 0);
});
test('legacy direct markets retain exact-pool destinations and existing guarded ABI', async () => {
  const f = fixture({ route: null });
  await f.buyOnChain(f.args); await f.sellOnChain(f.args); await f.redeemOnChain(f.args);
  const direct = f.sent.filter(tx => tx.to === a('a'));
  assert.equal(direct.length, 3);
  const iface = new ethers.utils.Interface(['function buy(bool,uint256,uint256)', 'function sell(bool,uint256,uint256)', 'function redeem(uint256)']);
  assert.deepEqual(direct.map(tx => iface.parseTransaction(tx).name), ['buy','sell','redeem']);
});
