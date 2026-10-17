import test from 'node:test';
import assert from 'node:assert/strict';
import { marketView, portfolioView } from './points-onchain-view.js';

const row = { id: 360636, mode: 'onchain', chain_id: 421614, chain_address: '0xabc', chain_market_id: '0',
  protocol_id: 3, protocol_chain_id: 421614, pool_address: '0xAbC', contract_market_id: 0,
  protocol_version: 'v1', protocol_outcomes: ['Sí', 'No'], protocol_status: 'active',
  yes_price: '0.6', no_price: '0.4', snapshot_at: '2026-10-17T10:00:00Z' };
const buy = (index, collateral, shares, block = 1) => ({ market_id: 3, side: 'buy', is_yes: index === 0,
  collateral_amt: collateral, shares_amt: shares, fee_amt: 0.25, block_number: block, log_index: index });

test('market mapping distinguishes all three IDs, zero contract IDs, and V1/V2 outcome numbering', () => {
  const view = marketView(row);
  assert.equal(view.id, 360636); assert.equal(view.protocolMarketId, 3); assert.equal(view.chainMarketId, '0');
  assert.deepEqual(view.prices, [0.6, 0.4]); assert.equal(view.outcome, null);
  assert.equal(marketView({ ...row, protocol_status: 'resolved', protocol_outcome: 1 }).outcome, 0);
  assert.equal(marketView({ ...row, protocol_status: 'resolved', protocol_outcome: 2 }).outcome, 1);
  assert.equal(marketView({ ...row, protocol_version: 'v2', protocol_status: 'resolved', protocol_outcome: 0 }).outcome, 0);
});

test('only linked server mappings expose factory identity for future-market consent coverage', () => {
  assert.equal(marketView({ ...row, factory_address: '0xAbC' }).factoryAddress, '0xabc');
  assert.equal(marketView({ ...row, factory_address: '0xAbC', protocol_id: null }).factoryAddress, null);
});

test('unlinked, inconsistent and unindexed markets have no fabricated prices or execution identity', () => {
  for (const patch of [{ protocol_id: null }, { protocol_chain_id: 84532 }, { contract_market_id: 7 }]) {
    const market = marketView({ ...row, ...patch });
    assert.equal(market.protocolMarketId, null); assert.equal(market.executionReady, false);
    assert.deepEqual(market.prices, []);
  }
  const pending = marketView({ ...row, yes_price: null, no_price: null, snapshot_at: null });
  assert.equal(pending.executionReady, false); assert.deepEqual(pending.prices, []);
});

test('YES and NO have independent basis; partial sells remove proportional basis without subtracting fees twice', () => {
  const sell = { ...buy(0, 3, 5, 2), side: 'sell', fee_amt: 0.1 };
  const result = portfolioView([marketView(row)], [sell, buy(1, 15, 30), buy(0, 10, 20)], []);
  const yes = result.positions.find(p => p.outcomeIndex === 0);
  const no = result.positions.find(p => p.outcomeIndex === 1);
  assert.equal(yes.shares, 15); assert.equal(yes.costBasis, 7.5); assert.equal(yes.realizedPnl, 0.5);
  assert.equal(yes.currentValue, 9); assert.equal(no.costBasis, 15); assert.equal(no.shares, 30);
  assert.equal(result.history[0].totalReceived, 3); assert.equal(result.summary.totalPnl, -1);
});

test('partial and full V1 redemptions remove winning shares and cannot leave double-claimable positions', () => {
  const market = marketView({ ...row, protocol_status: 'resolved', protocol_outcome: 1 });
  const first = { market_id: 3, outcome_index: null, shares: 5, payout: 5, block_number: 2, log_index: 0 };
  const partial = portfolioView([market], [buy(0, 10, 20)], [first]);
  assert.equal(partial.positions[0].shares, 15); assert.equal(partial.positions[0].claimablePayout, 15);
  assert.equal(partial.positions[0].costBasis, 7.5); assert.equal(partial.positions[0].canRedeem, true);
  const last = { ...first, shares: 15, payout: 15, block_number: 3 };
  const complete = portfolioView([market], [buy(0, 10, 20)], [last, first]);
  assert.deepEqual(complete.positions, []); assert.equal(complete.history[0].claimablePayout, 0);
  assert.equal(complete.history[0].canRedeem, false); assert.equal(complete.history[0].netPnl, 10);
  assert.equal(complete.summary.marketsTotal, 1); assert.equal(complete.summary.marketsWon, 1);
  assert.equal(complete.summary.marketsPending, 0);
  assert.equal(complete.summary.realizedPnl, 10);
  assert.deepEqual(portfolioView([market], [buy(0, 10, 20)], [last, first]), complete);
});

test('V2 third-outcome holdings redeem by index and losing shares value at zero', () => {
  const market = marketView({ ...row, protocol_version: 'v2', protocol_outcomes: ['A', 'B', 'C'],
    prices: ['0.2', '0.3', '0.5'], protocol_status: 'resolved', protocol_outcome: 2 });
  const trades = [{ ...buy(0, 6, 10), outcome_index: 0 }, { ...buy(2, 10, 20), outcome_index: 2 }];
  const result = portfolioView([market], trades, [{ market_id: 3, outcome_index: 2, shares: 20, payout: 20, block_number: 2 }]);
  assert.equal(result.positions.length, 1); assert.equal(result.positions[0].currentValue, 0);
  assert.equal(result.positions[0].canRedeem, false); assert.equal(result.summary.totalPnl, 4);
});

test('incomplete event history, missing valuation and unattributed cancellation burns fail explicitly', () => {
  const market = marketView(row);
  assert.throws(() => portfolioView([market], [{ ...buy(0, 3, 5), side: 'sell' }], []), /accounting_unavailable/);
  assert.throws(() => portfolioView([{ ...market, prices: [] }], [buy(0, 10, 20)], []), /index_pending/);
  assert.throws(() => portfolioView([{ ...market, status: 'resolved', outcome: null }], [buy(0, 10, 20)], []), /accounting_unavailable/);
  assert.throws(() => portfolioView([market], [buy(0, 10, 20)], [{ market_id: 3, shares: 0, payout: 10, block_number: 2 }]), /accounting_unavailable/);
});
