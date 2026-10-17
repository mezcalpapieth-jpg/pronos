import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ethers } from 'ethers';

const source = await readFile(new URL('./_lib/protocol-event-indexer.js', import.meta.url), 'utf8');
const extract = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const factorySource = extract('async function indexFactoryRange(', 'async function indexV1Pool(');
const poolSource = extract('async function indexV1Pool(', 'async function updateSeedLiquidity(');
const redemptionSource = extract('async function insertRedemption(', 'async function upsertPosition(');
const filters = new Proxy({}, { get: (_target, name) => () => name });

test('factory scan retains resolved, disputed and canceled pools within its chain/factory scope', async () => {
  const visited = [];
  const pools = ['active', 'resolved', 'disputed', 'canceled'].flatMap((status, i) =>
    ['v1', 'v2'].map((version, j) => ({ id: i * 2 + j, status, protocol_version: version })));
  const bindings = {
    ethers: { Contract: class { filters = filters; async queryFilter() { return []; } } }, CHAIN_ID: 421614,
    sql: async (parts, ...values) => {
      const query = parts.join('?');
      assert.match(query, /WHERE chain_id = \?/); assert.match(query, /factory_address = \?/);
      assert.deepEqual(values, [421614, 'sepolia-factory']);
      assert.doesNotMatch(query, /\bstatus\b/); // a post-resolution payout must remain discoverable
      return pools;
    },
    indexV1Pool: async (_provider, pool) => visited.push(['v1', pool.id]),
    indexV2Pool: async (_provider, pool) => visited.push(['v2', pool.id]),
  };
  const index = new Function(...Object.keys(bindings), `${factorySource}\nreturn indexFactoryRange;`)(...Object.values(bindings));
  await index({}, { address: 'sepolia-factory', abi: [] }, 100, 110, {});
  assert.deepEqual(visited, pools.map(p => [p.protocol_version, p.id]));
});

test('V1 and V2 record authoritative payout/share amounts only once when a closed-pool range is replayed', async () => {
  for (const version of ['v1', 'v2']) {
    const rows = new Map();
    const event = { args: { user: `0x${'A'.repeat(40)}`, outcomeIndex: ethers.BigNumber.from(2),
      shares: ethers.utils.parseUnits('63.169134', 6), payout: ethers.utils.parseUnits('63.169134', 6) },
      transactionHash: '0xredemption', blockNumber: 105, logIndex: 1 };
    const bindings = {
      ethers: { ...ethers, Contract: class { filters = filters;
        async queryFilter(name) { return name === 'WinningsRedeemed' ? [event] : []; }
        async reserveYes() { return 0; } async reserveNo() { return 0; }
        async prices() { throw Error('snapshot unavailable'); }
      } }, AMM_ABI: [], AMM_MULTI_ABI: [],
      sql: async (parts, ...values) => {
        assert.match(parts.join('?'), /ON CONFLICT \(tx_hash, log_index\) DO NOTHING/);
        const key = `${values[5]}:${values[7]}`;
        if (rows.has(key)) return [];
        rows.set(key, values); return [{ id: 1 }];
      },
    };
    const index = new Function(...Object.keys(bindings), `${redemptionSource}\n${poolSource}\nreturn ${version === 'v1' ? 'indexV1Pool' : 'indexV2Pool'};`)(...Object.values(bindings));
    const processed = { redemptions: 0 };
    for (let i = 0; i < 2; i++) await index({}, { id: 3, pool_address: 'pool', outcome_count: 3 }, 100, 110, processed);
    assert.equal(processed.redemptions, 1); assert.equal(rows.size, 1);
    const [row] = rows.values();
    assert.deepEqual(row.slice(0, 5), [3, event.args.user.toLowerCase(), version === 'v1' ? null : 2, 63.169134, 63.169134]);
  }
});
