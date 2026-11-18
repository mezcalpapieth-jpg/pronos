import assert from 'node:assert/strict';
import test from 'node:test';
import { readHip4SettlementReceipts } from './hip4-settlements.mjs';

const query = {
  environment: 'testnet', wallet: '0x' + 'A'.repeat(40), accountId: 'fixture-user',
  startTime: 1_794_427_700_000, endTime: 1_794_427_800_000,
};
const settlement = {
  dir: 'Settlement', coin: '#265931', side: 'A', px: '0.5', sz: '7.0',
  fee: '0.009812345678901234', feeToken: 'USDC', tid: 90615157753964, time: query.startTime + 1,
};
const fetchFills = fills => async () => ({ ok: true, json: async () => fills });

test('reads wallet-scoped HyperCore settlement fills and converts them to exact net receipts', async () => {
  const loser = { ...settlement, coin: '#265930', px: '0', fee: '0', tid: settlement.tid + 1 };
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.hyperliquid-testnet.xyz/info');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      type: 'userFillsByTime', user: query.wallet.toLowerCase(), startTime: query.startTime,
      endTime: query.endTime, aggregateByTime: false,
    });
    return fetchFills([loser, { ...settlement, dir: 'Sell' }, settlement, settlement])();
  };
  const receipts = await readHip4SettlementReceipts(query, fetchImpl);
  assert.deepEqual(receipts.map(({ environment, accountId, marketId, kind, amount }) =>
    [environment, accountId, marketId, kind, amount]), [
    ['testnet', 'fixture-user', '26593', 'settlement', '0'],
    ['testnet', 'fixture-user', '26593', 'settlement', '3.490187654321098766'],
  ]);
  assert.equal(receipts[1].eventId, receipts[1].reference);
  assert.match(receipts[1].reference, /:#265931:90615157753964$/);
});

test('does not book conversions, unverified responses, or incomplete read windows', async () => {
  assert.deepEqual(await readHip4SettlementReceipts(query, fetchFills([{ ...settlement, dir: 'Merge Outcome' }])), []);
  await assert.rejects(readHip4SettlementReceipts(query, fetchFills({ settleFraction: '0.5' })), /invalid_hypercore_fills/);
  await assert.rejects(readHip4SettlementReceipts(query, fetchFills(Array(2000).fill(settlement))), /window_too_dense/);
  await assert.rejects(readHip4SettlementReceipts(query, fetchFills([{ ...settlement, feeToken: 'other' }])), /invalid_hypercore_settlement/);
  await assert.rejects(readHip4SettlementReceipts(query, fetchFills([{ ...settlement, fee: '8' }])), /invalid_settlement_payout/);
  await assert.rejects(readHip4SettlementReceipts(query, fetchFills([settlement, { ...settlement, fee: '0' }])), /conflicting_hypercore_settlement/);
});
