import test from 'node:test';
import assert from 'node:assert/strict';
import { delegationCoversMarket } from './delegationCoverage.js';
const a = n => `0x${n.repeat(40)}`;
const target = { mode: 'onchain', chainId: 421614, protocolMarketId: 12, chainAddress: a('a'), factoryAddress: a('b') };
const status = { active: true, chainId: 421614, authorizationScope: 'router', coversFutureMarkets: true,
  routerAddress: a('c'), coveredFactories: [a('b')], coveredPools: [] };
test('future registered factory mappings are covered without a new pool consent', () => {
  assert.equal(delegationCoversMarket(status, target), true);
  assert.equal(delegationCoversMarket(status, { ...target, chainAddress: a('d'), protocolMarketId: 999 }), true);
});
test('active alone, another chain/factory, missing mapping or unverified router scope cannot skip consent', () => {
  for (const patch of [{ active: false }, { chainId: 84532 }, { authorizationScope: 'pools' }, { coversFutureMarkets: false }, { routerAddress: null }, { coveredFactories: [a('e')] }]) {
    assert.equal(delegationCoversMarket({ ...status, ...patch }, target), false);
  }
  for (const patch of [{ chainId: 84532 }, { protocolMarketId: null }, { mode: 'points' }, { factoryAddress: null }]) {
    assert.equal(delegationCoversMarket(status, { ...target, ...patch }), false);
  }
  const legacy = { ...status, authorizationScope: 'pools', coversFutureMarkets: false, coveredFactories: [], coveredPools: [a('a')] };
  assert.equal(delegationCoversMarket(legacy, target), true);
  assert.equal(delegationCoversMarket(legacy, { ...target, chainAddress: a('d') }), false);
});
