import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import { authorizeGasTrade } from './sepolia-user-gas.js';
import { buildTradingDelegation } from './trading-delegation.js';

const a = n => `0x${String(n).repeat(40)}`, bn = ethers.BigNumber.from;
function fixture({ binary = true, routed = true } = {}) {
  const owner = a(1), pool = a(5);
  const config = { walletAddress: owner, backendPublicKey: `02${'ab'.repeat(32)}`, chainId: 421614,
    collateral: a(2), shares: { v1: a(3), v2: a(4) },
    pools: [{ address: pool, version: binary ? 'v1' : 'v2', routed }],
    router: routed ? { address: a(6), factories: [a(7), a(8)] } : null };
  const policy = buildTradingDelegation({ ...config, pools: routed ? [] : config.pools }).policy;
  const grant = { row: { wallet_address: owner, delegation_policy_id: 'policy' },
    config, snapshot: { policies: [{ ...policy, policyId: 'policy' }] }, backendUserId: 'backend', policyIds: ['policy'] };
  const users = [{ wallet_address: owner, turnkey_sub_org_id: 'account' }];
  const state = { holdings: bn(100), estimate: bn(100), paused: false, resolved: false, canceled: false,
    tokenId: null, simulations: [], simulationError: null };
  const amm = {
    paused: async () => state.paused, resolved: async () => state.resolved, canceled: async () => state.canceled,
    collateral: async () => a(2), token: async () => binary ? a(3) : a(4), marketId: async () => bn(7),
  };
  for (const action of ['estimateBuy', 'estimateSell']) for (const type of ['bool', 'uint8']) {
    amm[`${action}(${type},uint256)`] = async () => state.estimate;
  }
  const token = { 'balanceOf(address)': async () => state.holdings,
    'balanceOf(address,uint256)': async (_owner, id) => { state.tokenId = id.toString(); return state.holdings; },
    tokenId: async (_market, outcome) => bn(700 + outcome) };
  const args = { sql: async () => users, provider: { send: async (method, params) => {
    assert.equal(method, 'eth_call'); assert.equal(params[1], 'latest');
    state.simulations.push(params[0]); if (state.simulationError) throw Error(state.simulationError);
  } },
    suborgId: 'account', ownerAddr: owner, pool, route: routed ? config.router : null,
    action: 'buy', binary, units: bn(10), outcomeIndex: binary ? 0 : 2, minOut: bn(5),
    target: routed ? a(6) : pool, data: '0xdeadbeef',
    loadDelegation: async () => grant, contractAt: address => address === pool ? amm : token };
  return { args, state, users, grant };
}

test('binary/multi and routed/legacy trades require sufficient collateral or shares', async () => {
  for (const binary of [true, false]) for (const routed of [true, false]) {
    const f = fixture({ binary, routed });
    await authorizeGasTrade(f.args);
    await authorizeGasTrade({ ...f.args, action: 'sell' });
    assert.equal(f.state.tokenId, binary ? '14' : '702');
    f.state.holdings = bn(9);
    await assert.rejects(authorizeGasTrade(f.args), /insufficient_balance/);
    await assert.rejects(authorizeGasTrade({ ...f.args, action: 'sell' }), /insufficient_available_shares/);
  }
});

test('mapping ambiguity, revoked/wrong-wallet grants and uncovered pools cannot receive gas', async () => {
  const changes = [
    f => f.users.push({ ...f.users[0] }),
    f => { f.users[0].turnkey_sub_org_id = 'other'; },
    f => { f.grant.row.wallet_address = a(9); },
    f => { f.grant.snapshot.policies = []; },
    f => { f.grant.policyIds.push('old-policy'); },
    f => { f.grant.backendUserId = null; },
    f => { f.grant.snapshot.policies[0].condition += ' || true'; },
    f => { f.args.pool = a(9); },
    f => { f.args.route = null; },
  ];
  for (const change of changes) {
    const f = fixture(); change(f);
    await assert.rejects(authorizeGasTrade(f.args));
    assert.equal(f.state.simulations.length, 0);
  }
});

test('inactive pools, price movement, zero-size orders and invalid outcomes fail before funding', async () => {
  for (const state of [{ paused: true }, { resolved: true }, { canceled: true }, { estimate: bn(4) }, { estimate: bn(0) }]) {
    const f = fixture(); Object.assign(f.state, state);
    await assert.rejects(authorizeGasTrade(f.args));
  }
  for (const overrides of [{ units: bn(0) }, { outcomeIndex: -1 }, { outcomeIndex: 2 }, { minOut: bn(0) }]) {
    await assert.rejects(authorizeGasTrade({ ...fixture().args, ...overrides }));
  }
});

test('redemptions simulate the exact owner call, rejecting disputed or non-redeemable positions', async () => {
  const f = fixture();
  await authorizeGasTrade({ ...f.args, action: 'redeem' });
  assert.deepEqual(f.state.simulations[0], { from: a(1), to: a(6), data: '0xdeadbeef', gasPrice: '0x0' });
  f.state.simulationError = 'PronosAMM: disputed';
  await assert.rejects(authorizeGasTrade({ ...f.args, action: 'redeem' }), /disputed/);
});
