import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';
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

test('legacy tokens reconstruct outstanding supply from anchored mints and burns', async () => {
  const args = fixture('v1');
  const { market, provider } = args;
  const original = args.contractAt;
  const tokenAddress = await original(market.pool_address).token({ blockTag: 77 });
  const token = original(tokenAddress);
  token.totalSupply = async () => { throw Object.assign(Error('missing method'), { code: 'CALL_EXCEPTION', data: '0x' }); };
  const events = new ethers.utils.Interface([
    'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime)',
    'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
    'event TransferBatch(address indexed operator,address indexed from,address indexed to,uint256[] ids,uint256[] values)',
  ]);
  const zero = ethers.constants.AddressZero, pool = market.pool_address, seedTx = '0x' + 'ab'.repeat(32);
  market.creation_tx_hash = seedTx;
  const event = (name, params, transactionHash) => ({
    ...events.encodeEventLog(events.getEvent(name), params), blockNumber: 40, transactionHash,
  });
  const created = event('MarketCreated', [0,pool,'Fixture','general',99],seedTx);
  const minted = event('TransferBatch', [pool,zero,pool,[0,1,99],[22_000_000,25_000_000,2_000_000]],seedTx);
  const burned = [event('TransferSingle',[pool,pool,zero,0,2_000_000],'0xtrade'),
    event('TransferSingle',[pool,pool,zero,1,5_000_000],'0xtrade')];
  provider.getTransactionReceipt = async hash => {
    assert.equal(hash, seedTx);
    return {status:1,blockNumber:40,transactionHash:seedTx,logs:[{...created,address:market.factory_address}]};
  };
  provider.getLogs = async filter => {
    assert.equal(filter.toBlock,77);
    assert.equal(filter.address,tokenAddress);
    assert.equal(filter.fromBlock,40);
    return [minted,...burned].filter(row => filter.topics.every((topic,i) => topic == null || row.topics[i] === topic));
  };
  const result = await previewResolutionPayouts(args);
  assert.deepEqual(result.payouts, [
    { outcome:0,payoutUnits:'5000000',shortfallUnits:'0' },
    { outcome:1,payoutUnits:'10000000',shortfallUnits:'1000000' },
  ]);
  minted.transactionHash = '0xwrong';
  await assert.rejects(previewResolutionPayouts(args), /settlement_share_supply_unavailable/);
});
