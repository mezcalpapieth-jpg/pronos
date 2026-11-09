import test from 'node:test';
import assert from 'node:assert/strict';
import { previewResolutionPayouts } from './onchain-resolution-payouts.js';
import { preview as env } from './test-support/sepolia-settlement.mjs';

function fixture(variant, { end = 99, moved = false, resolved = false, balance = 9_000_000n } = {}) {
  const multi = variant === 'v2';
  const addr = n => `0x${String(n).repeat(40)}`;
  const pool = addr(4), collateral = addr(3), factory = addr(multi ? 2 : 1), shares = addr(5);
  const block = { number: 77, timestamp: 100, hash: `0x${'ab'.repeat(32)}` };
  const read = value => async (...args) => { assert.deepEqual(args.at(-1), { blockTag: 77 }); return value; };
  const tokens = {
    yesTokenId: read(0), noTokenId: read(1),
    tokenId: async (id, index, at) => { assert.equal(id, '0'); assert.equal(at.blockTag, 77); return index; },
    totalSupply: read(20_000_000n),
    balanceOf: async (holder, id, at) => {
      assert.equal(holder, pool); assert.equal(at.blockTag, 77);
      return [15_000_000n, 10_000_000n, 20_000_000n][id];
    },
  };
  const contracts = {
    [pool]: { token: read(shares), collateral: read(collateral), resolved: read(resolved), disputed: read(false), canceled: read(false) },
    [factory]: { getMarket: read([pool, 'Fixture', 'general', end, '', ...(multi ? [3] : []), true]), collateral: read(collateral) },
    [shares]: tokens,
    [collateral]: { balanceOf: read(balance) },
  };
  return {
    market: { pool_address: pool, factory_address: factory, protocol_version: variant, status: 'active', outcome_count: multi ? 3 : 2, contract_id: '0' },
    provider: { getBlock: async tag => moved && tag === 77 ? { ...block, hash: '0xchanged' } : block },
    env, contractAt: address => contracts[address],
  };
}

for (const variant of ['v1', 'v2']) test(`${variant} estimates outstanding winner claims excluding the pool’s reserve at one block`, async () => {
  const args = fixture(variant);
  const result = await previewResolutionPayouts(args);
  assert.equal(result.blockNumber, 77);
  assert.equal(result.poolBalanceUnits, '9000000');
  assert.deepEqual(result.payouts.slice(0, 2), [
    { outcome: 0, payoutUnits: '5000000', shortfallUnits: '0' },
    { outcome: 1, payoutUnits: '10000000', shortfallUnits: '1000000' },
  ]);
  assert.deepEqual((await previewResolutionPayouts({ ...args, outcome: 1 })).payouts, [result.payouts[1]]);
  if (variant === 'v2') assert.deepEqual(result.payouts[2], { outcome: 2, payoutUnits: '0', shortfallUnits: '0' });
});

test('open, resolved and reorganized markets cannot yield a reviewable payout', async () => {
  await assert.rejects(previewResolutionPayouts(fixture('v1', { end: 101 })), /settlement_market_still_open/);
  await assert.rejects(previewResolutionPayouts(fixture('v1', { resolved: true })), /settlement_market_state_changed/);
  await assert.rejects(previewResolutionPayouts(fixture('v2', { moved: true })), /settlement_resolution_anchor_changed/);
});
