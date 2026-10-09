import assert from 'node:assert/strict';
import test from 'node:test';
import { binaryBuyQuote, binaryPrices, binarySellQuote, multiBuyQuote, multiSellQuote, multiPrices } from './amm-math.js';
import { previewHybridBuy as buy, previewHybridSell as sell } from './points-trade-router.js';

const near = (a, b, tolerance = 0.00001) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const order = (id, price, amount, overrides = {}) => ({
  id, username: `maker-${id}`, status: 'open', limit_price: price,
  remaining_amount: amount, created_at: '2026-10-01T00:00:00Z', ...overrides,
});

test('AMM-only routing exactly preserves the existing fee and reserve math', () => {
  for (const oi of [0, 1]) {
    for (const amount of [1, 99, 100, 101, 900, 5000]) {
      const reserves = [500, 750];
      const q = binaryBuyQuote(reserves, oi, amount);
      const routed = buy([], { reserves, outcomeIndex: oi, collateral: amount });
      assert.equal(routed.sharesOut, q.sharesOut);
      assert.equal(routed.fee, q.fee);
      assert.deepEqual(routed.reservesAfter, q.reservesAfter);
      const exit = sell([], { reserves: routed.reservesAfter, outcomeIndex: oi, shares: routed.sharesOut });
      assert.equal(exit.collateralOut, binarySellQuote(routed.reservesAfter, oi, routed.sharesOut).collateralOut);
      near(exit.collateralOut, amount - routed.fee, 0.0001);
      assert.ok(exit.collateralOut <= amount);
    }
  }
});

test('the two-sided 900/500 buy-and-unwind exploit cannot create cash', () => {
  const yes = buy([], { reserves: [500, 500], outcomeIndex: 0, collateral: 900 });
  const no = buy([], { reserves: yes.reservesAfter, outcomeIndex: 1, collateral: 500 });
  const exitYes = sell([], { reserves: no.reservesAfter, outcomeIndex: 0, shares: yes.sharesOut });
  const exitNo = sell([], { reserves: exitYes.reservesAfter, outcomeIndex: 1, shares: no.sharesOut });
  near(exitYes.collateralOut + exitNo.collateralOut, 1371.501294);
  assert.ok(exitYes.collateralOut + exitNo.collateralOut < 1400);
  assert.ok([...yes.fills, ...no.fills, ...exitYes.fills, ...exitNo.fills].every(f => f.source === 'amm'));
});

test('buys compare fee-inclusive marginal prices, not whole-order averages', () => {
  const routed = buy([order(1, 0.51, 1000)], {
    reserves: [500, 500], outcomeIndex: 0, collateral: 100,
  });
  assert.equal(routed.fills.length, 1);
  assert.equal(routed.fills[0].source, 'limit');
  near(routed.sharesOut, 100 / 0.51);
  assert.equal(routed.fee, 0);
  assert.deepEqual(routed.reservesAfter, [500, 500]);
});

test('a buy alternates AMM and real asks in price order with continuous reserves', () => {
  const routed = buy([order(2, 0.65, 100), order(1, 0.6, 50)], {
    reserves: [500, 500], outcomeIndex: 0, collateral: 300,
  });
  assert.deepEqual(routed.fills.map(f => f.source), ['amm', 'limit', 'amm', 'limit', 'amm']);
  let previous = [500, 500];
  for (const f of routed.fills) {
    assert.deepEqual(f.reservesBefore, previous);
    if (f.source === 'limit') assert.deepEqual(f.reservesAfter, previous);
    assert.ok(binaryPrices(f.reservesAfter)[0] >= binaryPrices(previous)[0]);
    previous = f.reservesAfter;
  }
  near(routed.collateralSpent, 300);
  assert.ok(routed.sharesOut >= binaryBuyQuote([500, 500], 0, 300).sharesOut);
});

test('sells walk the AMM to each bid instead of selling everything to the book first', () => {
  const routed = sell([order(1, 0.4, 10000)], {
    reserves: [500, 500], outcomeIndex: 0, shares: 1000,
  });
  assert.deepEqual(routed.fills.map(f => f.source), ['amm', 'limit']);
  near(routed.collateralOut, 410.102051);
  near(routed.priceAfter, 0.4);
  assert.ok(routed.collateralOut > 400);
  const limited = sell([order(1, 0.45, 10), order(2, 0.4, 10)], {
    reserves: [500, 500], outcomeIndex: 0, shares: 500,
  });
  assert.deepEqual(limited.fills.map(f => f.source), ['amm', 'limit', 'amm', 'limit', 'amm']);
  for (const f of limited.fills.filter(f => f.source === 'limit')) assert.ok(f.collateral <= 10);
  assert.ok(limited.collateralOut >= binarySellQuote([500, 500], 0, 500).collateralOut);
});

test('quotes exclude own, expired, closed, and invalid orders and honor price-time priority', () => {
  const rows = [
    order(1, 0.2, 1000, { username: 'taker' }),
    order(2, 0.2, 1000, { expires_at: '2000-01-01T00:00:00Z' }),
    order(3, 0.2, 1000, { status: 'cancelled' }),
    order(4, 0, 1000),
    order(6, 0.51, 10, { created_at: '2026-10-02T00:00:00Z' }),
    order(5, 0.51, 10),
  ];
  const routed = buy(rows, { reserves: [500, 500], outcomeIndex: 0, collateral: 100, username: 'taker' });
  assert.deepEqual(routed.fills.filter(f => f.source === 'limit').map(f => f.orderId), [5, 6]);
  const ownBid = sell([order(1, 0.9, 1000, { username: 'taker' })], {
    reserves: [500, 500], outcomeIndex: 0, shares: 100, username: 'taker',
  });
  assert.equal(ownBid.fills.length, 1);
  assert.equal(ownBid.fills[0].source, 'amm');
});

test('binary and multi-option cycles conserve cash minus fees over varied states and exit orders', () => {
  for (const reserves of [[90, 910], [1000, 1000], [500, 750, 250], [500, 500, 500, 500]]) {
    for (const amount of [10, 100, 400]) {
      for (const reverse of [false, true]) {
        let next = reserves;
        let fee = 0;
        let cash = 0;
        const positions = [];
        for (let oi = 0; oi < reserves.length; oi++) {
          const q = buy([], { reserves: next, outcomeIndex: oi, collateral: amount });
          next = q.reservesAfter;
          positions.push({ oi, shares: q.sharesOut });
          cash -= q.collateralSpent;
          fee += q.fee;
        }
        if (reverse) positions.reverse();
        for (const { oi, shares } of positions) {
          const q = sell([], { reserves: next, outcomeIndex: oi, shares });
          next = q.reservesAfter;
          cash += q.collateralOut;
        }
        assert.ok(cash <= 0, `profitable cycle: ${cash}`);
        near(cash, -fee, 0.0001);
        next.forEach((r, i) => near(r, reserves[i], 0.0001));
        const p = next.length === 2 ? binaryPrices(next) : multiPrices(next);
        near(p.reduce((sum, value) => sum + value, 0), 1, 0.000005);
      }
    }
  }
});

test('funded hybrid routes never underperform the AMM-only alternative across 1000 varied books', () => {
  let seed = 51;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < 1000; i++) {
    const count = 2 + i % 3;
    const reserves = Array.from({ length: count }, () => 10 + random() * 2000);
    const oi = i % count;
    const amount = Math.round((1 + random() * 3000) * 1e6) / 1e6;
    const rows = Array.from({ length: 5 }, (_, id) => order(id, 0.01 + random() * 0.98, 1 + random() * 500));
    const bought = buy(rows, { reserves, outcomeIndex: oi, collateral: amount });
    const sold = sell(rows, { reserves, outcomeIndex: oi, shares: amount });
    const ammBuy = (count === 2 ? binaryBuyQuote : multiBuyQuote)(reserves, oi, amount);
    const ammSell = (count === 2 ? binarySellQuote : multiSellQuote)(reserves, oi, amount);
    assert.ok(bought.sharesOut + 0.0001 >= ammBuy.sharesOut, `buy book ${i}`);
    assert.ok(sold.collateralOut + 0.0001 >= ammSell.collateralOut, `sell book ${i}`);
    assert.ok(bought.collateralSpent <= amount + 0.000001);
    assert.ok(sold.sharesSold <= amount + 0.000001);
    assert.ok(bought.reservesAfter.every(r => r > 0));
    assert.ok(sold.reservesAfter.every(r => r > 0));
  }
});
