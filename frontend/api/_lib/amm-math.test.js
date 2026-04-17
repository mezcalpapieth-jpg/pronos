/**
 * Unit tests for the off-chain AMM math.
 *
 * Run with:
 *   node --test frontend/api/_lib/amm-math.test.js
 *
 * These tests are the "audit" for our replacement of PronosAMM.sol. If any
 * of them fail, user balances will be computed incorrectly and the app must
 * not ship.
 *
 * Scope:
 *   - Binary (N=2): exercises the audited binary CPMM mirroring the
 *     PronosAMM.sol contract.
 *   - Unified multi (N=3): exercises multiBuyQuote + multiSellQuote, which
 *     support W/D/L markets with prices summing to 100% and sell via
 *     Newton's iteration on the cubic sell polynomial.
 *   - N ≥ 4 is handled outside this module (parallel binary event groups),
 *     so we don't exercise it here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  binaryBuyQuote,
  binarySellQuote,
  binaryPrices,
  calculateFeeRaw,
  toRaw,
  fromRaw,
  initialReserves,
  redeemPayout,
  multiBuyQuote,
  multiSellQuote,
  multiPrices,
} from './amm-math.js';

// Helper: compare two numbers within a tolerance.
function approxEqual(actual, expected, epsilon, message) {
  const diff = Math.abs(actual - expected);
  assert.ok(
    diff <= epsilon,
    `${message || ''}: expected ${actual} to be within ${epsilon} of ${expected} (diff = ${diff})`,
  );
}

// ─── Conversions ─────────────────────────────────────────────────────────────
test('toRaw / fromRaw round-trip at 6 decimals', () => {
  assert.equal(toRaw(1), 1_000_000n);
  assert.equal(toRaw(1.5), 1_500_000n);
  assert.equal(toRaw(0.000001), 1n);
  assert.equal(fromRaw(1_000_000n), 1);
  assert.equal(fromRaw(2_500_000n), 2.5);
});

test('toRaw rejects NaN and Infinity', () => {
  assert.throws(() => toRaw(NaN));
  assert.throws(() => toRaw(Infinity));
});

// ─── Fee model ───────────────────────────────────────────────────────────────
test('fee at 50/50 = 2.5% for YES buy', () => {
  const reserveYes = toRaw(500);
  const reserveNo = toRaw(500);
  const amount = toRaw(100);
  const fee = calculateFeeRaw(amount, reserveYes, reserveNo, true);
  // 100 × 2.5% = 2.5 MXNP = 2_500_000 raw
  assert.equal(fee, 2_500_000n, 'fee at 50/50 should be 2.5%');
});

test('fee at 90/10 = 0.5% for YES buy', () => {
  // P(YES) = 0.9 needs reserveNo = 9 × reserveYes.
  const reserveYes = toRaw(100);
  const reserveNo = toRaw(900);
  const amount = toRaw(100);
  const fee = calculateFeeRaw(amount, reserveYes, reserveNo, true);
  assert.equal(fee, 500_000n, 'fee at 90/10 should be 0.5%');
});

test('fee at 99/1 ≈ 0.05% for YES buy', () => {
  const reserveYes = toRaw(10);
  const reserveNo = toRaw(990);
  const amount = toRaw(100);
  const fee = calculateFeeRaw(amount, reserveYes, reserveNo, true);
  approxEqual(fromRaw(fee), 0.05, 0.001, 'fee at 99/1');
});

test('empty pool uses 2.5% default fee', () => {
  const fee = calculateFeeRaw(toRaw(100), 0n, 0n, true);
  assert.equal(fee, 2_500_000n);
});

// ─── Binary CPMM basic properties ────────────────────────────────────────────
test('buy at 50/50 gives more YES shares than collateral paid net of fee', () => {
  const reserves = [500, 500];
  const q = binaryBuyQuote(reserves, 0, 100);
  // After 2.5% fee: 97.5 MXNP net. Mint 97.5 YES + 97.5 NO, then swap via CPMM.
  // sharesOut = (reserveYes + net) - k / (reserveNo + net)
  //           ≈ (500 + 97.5) - 250_000 / (500 + 97.5)
  //           ≈ 597.5 - 418.41
  //           ≈ 179.1
  assert.ok(q.sharesOut > 97.5, 'buying 100 at 50/50 should yield >97.5 shares');
  assert.ok(q.sharesOut < 200, 'sharesOut should be less than 2× collateral');
  approxEqual(q.fee, 2.5, 0.01, 'fee at 50/50 is 2.5 MXNP');
  approxEqual(q.priceBefore, 0.5, 0.0001, 'priceBefore is 50%');
  assert.ok(q.priceAfter > q.priceBefore, 'buying YES should raise P(YES)');
});

test('CPMM invariant: k stays within rounding after buy', () => {
  const reserves = [500, 500];
  const q = binaryBuyQuote(reserves, 0, 100);
  const [newYes, newNo] = q.reservesAfterRaw;
  const kBefore = toRaw(500) * toRaw(500);
  const kAfter = newYes * newNo;
  // Contract rounds up newYes so kAfter >= kBefore but by a tiny bias.
  const drift = Number(kAfter - kBefore) / Number(kBefore);
  approxEqual(drift, 0, 0.001, 'k invariant should not drift >0.1%');
});

test('buy-then-sell: recovery close to 1 − buyFee (no sell fee)', () => {
  const reserves = [1000, 1000];
  const buy = binaryBuyQuote(reserves, 0, 50);
  const sell = binarySellQuote(buy.reservesAfter, 0, buy.sharesOut);
  const recovery = sell.collateralOut / 50;
  // Only the buy fee + minuscule CPMM rounding reduce the round-trip.
  // Buy fee at 50/50 was 2.5%, so recovery should be ~97.5%+ since no
  // additional sell fee is charged.
  assert.ok(recovery < 1, `should recover less than paid — got ${recovery}`);
  assert.ok(recovery > 0.97, `should recover >97% (only buy fee) — got ${recovery}`);
});

test('buying YES and buying NO both raise the price of the bought side', () => {
  const r = [500, 500];
  const buyYes = binaryBuyQuote(r, 0, 100);
  const buyNo = binaryBuyQuote(r, 1, 100);
  // priceAfter is always the price of the outcome just bought.
  assert.ok(buyYes.priceAfter > 0.5, 'YES buy raises P(YES)');
  assert.ok(buyNo.priceAfter > 0.5, 'NO buy raises P(NO) (= 1 - P(YES))');
  // Use pricesAfter to check directional movement of P(YES) specifically:
  assert.ok(buyYes.pricesAfter[0] > 0.5, 'YES buy raises P(YES)');
  assert.ok(buyNo.pricesAfter[0] < 0.5, 'NO buy lowers P(YES)');
});

test('larger buy has more slippage than smaller buy', () => {
  const r = [1000, 1000];
  const small = binaryBuyQuote(r, 0, 10);
  const big = binaryBuyQuote(r, 0, 500);
  const smallImpact = small.priceAfter - small.priceBefore;
  const bigImpact = big.priceAfter - big.priceBefore;
  assert.ok(bigImpact > smallImpact, 'big trade should have bigger price impact');
});

test('price monotonic across sequential buys', () => {
  let reserves = [1000, 1000];
  let lastPrice = 0.5;
  for (let i = 0; i < 5; i += 1) {
    const q = binaryBuyQuote(reserves, 0, 50);
    assert.ok(q.priceAfter > lastPrice, `buy #${i + 1} should raise price, got ${q.priceAfter}`);
    lastPrice = q.priceAfter;
    reserves = q.reservesAfter;
  }
});

test('sell returns no more than spot value and reports zero fee', () => {
  const reserves = [1000, 1000];
  const buy = binaryBuyQuote(reserves, 0, 100);
  const sell = binarySellQuote(buy.reservesAfter, 0, buy.sharesOut);
  const spot = buy.sharesOut * buy.priceAfter;
  assert.ok(sell.gross <= spot, 'gross sell cannot exceed spot value');
  // Sells are fee-free in the points app: collateralOut === gross.
  assert.equal(sell.fee, 0, 'sell fee is always zero');
  assert.equal(sell.feePct, 0, 'sell feePct is always zero');
  assert.equal(sell.collateralOut, sell.gross, 'collateralOut equals gross for sells');
});

test('zero or negative input trades throw', () => {
  const r = [500, 500];
  assert.throws(() => binaryBuyQuote(r, 0, 0));
  assert.throws(() => binaryBuyQuote(r, 0, -1));
  assert.throws(() => binarySellQuote(r, 0, 0));
});

test('absurdly large sell produces a terrible but valid price (math never returns nonsense)', () => {
  // The CPMM math always returns a c strictly less than the opposing
  // reserve, so selling an absurd amount doesn't throw — it just drives
  // the price to near-0 and returns a tiny collateralOut. The "user has
  // enough shares" check is the server's job, not the math's.
  const tinyPool = [10, 10];
  const sell = binarySellQuote(tinyPool, 0, 1_000_000);
  assert.ok(sell.collateralOut > 0, 'even absurd sells return positive collateral');
  assert.ok(sell.collateralOut < 10, 'absurd sell cannot drain pool beyond opposing reserve');
  assert.ok(sell.priceAfter < 0.01, 'price of sold side is crushed to near-zero');
});

test('binaryPrices sums to 1 on any valid reserves', () => {
  const cases = [[500, 500], [100, 900], [50, 50], [1, 999]];
  for (const r of cases) {
    const [pYes, pNo] = binaryPrices(r);
    approxEqual(pYes + pNo, 1, 0.00001, `reserves ${JSON.stringify(r)}`);
  }
});

test('initialReserves returns uniform reserves at 50/50', () => {
  assert.deepEqual(initialReserves(500), [500, 500]);
  assert.deepEqual(initialReserves(1000), [1000, 1000]);
});

// ─── Redeem ──────────────────────────────────────────────────────────────────
test('redeem pays 1 MXNP per winning share, 0 per losing', () => {
  assert.equal(redeemPayout(10, 0, 0), 10);
  assert.equal(redeemPayout(10, 1, 0), 0);
  assert.equal(redeemPayout(0, 0, 0), 0);
  assert.equal(redeemPayout(100.5, 1, 1), 100.5);
});

// ─── Reserves actually update correctly ──────────────────────────────────────
test('binary buy YES: YES reserve shrinks, NO reserve grows', () => {
  const r = [500, 500];
  const q = binaryBuyQuote(r, 0, 100);
  assert.ok(q.reservesAfter[0] < 500, 'YES reserve shrank');
  assert.ok(q.reservesAfter[1] > 500, 'NO reserve grew');
});

test('binary sell YES: NO reserve shrinks (pool paid out c of NO)', () => {
  const r = [1000, 1000];
  const buy = binaryBuyQuote(r, 0, 100);
  const sell = binarySellQuote(buy.reservesAfter, 0, buy.sharesOut);
  assert.ok(sell.reservesAfter[1] < buy.reservesAfter[1], 'NO reserve decreased on YES sell');
});

// ─── Full trading flow end-to-end ────────────────────────────────────────────
test('full lifecycle: seed → buy → sell → resolve → redeem', () => {
  let reserves = initialReserves(500);

  // Alice buys 100 MXNP of YES
  const buyA = binaryBuyQuote(reserves, 0, 100);
  reserves = buyA.reservesAfter;

  // Bob buys 50 MXNP of NO
  const buyB = binaryBuyQuote(reserves, 1, 50);
  reserves = buyB.reservesAfter;

  // Alice sells half her shares
  const sellA = binarySellQuote(reserves, 0, buyA.sharesOut / 2);
  reserves = sellA.reservesAfter;

  // Market resolves YES (outcome_index = 0)
  const winningOutcome = 0;
  const aliceRemainingShares = buyA.sharesOut / 2;
  const alicePayout = redeemPayout(aliceRemainingShares, 0, winningOutcome);
  const bobPayout = redeemPayout(buyB.sharesOut, 1, winningOutcome);

  assert.equal(alicePayout, aliceRemainingShares, 'Alice redeems her remaining YES shares 1:1');
  assert.equal(bobPayout, 0, 'Bob gets nothing (bet wrong side)');

  const aliceNet = sellA.collateralOut + alicePayout - 100;
  assert.ok(aliceNet > 0, `Alice should be profitable after win — got ${aliceNet}`);

  console.log(`  ↳ Alice net: +${aliceNet.toFixed(2)} MXNP`);
  console.log(`  ↳ Bob net:   ${(bobPayout - 50).toFixed(2)} MXNP (loss)`);
});

// ─── Multi-outcome as parallel binary: sanity check the pattern ──────────────
test('multi-outcome as N parallel binary markets works end-to-end', () => {
  // Simulate "Who wins the World Cup?" with 3 teams (Mexico, Brazil, Argentina).
  // Each team is its own binary market. User bets YES on Mexico.
  const mexicoMarket    = initialReserves(500);
  const brazilMarket    = initialReserves(500);
  const argentinaMarket = initialReserves(500);

  // User bets 100 on Mexico YES
  const buy = binaryBuyQuote(mexicoMarket, 0, 100);

  // Suppose Brazil wins. Mexico's YES shares → 0, Brazil's YES shares → win.
  const mexicoWinningOutcome = 1; // "No" — Mexico did NOT win
  const userPayout = redeemPayout(buy.sharesOut, 0, mexicoWinningOutcome);
  assert.equal(userPayout, 0, 'Mexico YES bet loses when Brazil wins');

  // Another user had bet YES on Brazil and wins.
  const otherUserBuy = binaryBuyQuote(brazilMarket, 0, 50);
  const brazilWinningOutcome = 0; // YES — Brazil won
  const otherPayout = redeemPayout(otherUserBuy.sharesOut, 0, brazilWinningOutcome);
  assert.ok(otherPayout > 50, `Brazil YES bet wins — got ${otherPayout}`);
});

// ────────────────────────────────────────────────────────────────────────────
// Unified multi-outcome (N = 3) — buy + sell + prices
// ────────────────────────────────────────────────────────────────────────────
// These cover the path used by W/D/L sports markets where admins want
// prices to sum to 100% and a single pool per event.

test('multiPrices on symmetric 3-outcome pool is 1/3 each', () => {
  const ps = multiPrices([500, 500, 500]);
  approxEqual(ps[0], 1/3, 0.0001, 'P_0');
  approxEqual(ps[1], 1/3, 0.0001, 'P_1');
  approxEqual(ps[2], 1/3, 0.0001, 'P_2');
  approxEqual(ps.reduce((s, p) => s + p, 0), 1, 0.0001, 'sum = 1');
});

test('multiPrices: skewed 3-outcome pool reflects implied odds', () => {
  // Outcome 0 has been bought heavily (low reserve → expensive).
  // Expected: P_0 > P_1 = P_2, and all sum to ~1.
  const ps = multiPrices([100, 500, 500]);
  assert.ok(ps[0] > ps[1], 'depleted reserve ⇒ higher price');
  approxEqual(ps[1], ps[2], 0.0001, 'symmetric pair');
  approxEqual(ps[0] + ps[1] + ps[2], 1, 0.0001, 'sum = 1');
});

test('multiBuyQuote (N=3): buy at symmetric pool charges 3.33% fee', () => {
  const q = multiBuyQuote([500, 500, 500], 0, 100);
  // fee = 5% × (1 − 1/3) = 3.333%
  approxEqual(q.feePct, 3.3333, 0.01, 'fee% at equal reserves');
  assert.ok(q.sharesOut > 100, 'at ~33¢ per share, 100 MXNP buys > 100 shares');
  // Avg price below 0.5 and above 0.333 (starting price).
  assert.ok(q.avgPrice > 0.333 && q.avgPrice < 0.5,
    `avg price plausible — got ${q.avgPrice}`);
  // Price of outcome 0 increases; 1 and 2 decrease.
  assert.ok(q.priceAfter > q.priceBefore, 'buying 0 should push P_0 up');
  approxEqual(q.pricesAfter.reduce((s, p) => s + p, 0), 1, 0.0001,
    'post-trade prices sum to 1');
});

test('multiBuyQuote (N=3): reserves-after match invariant', () => {
  // Buying outcome i should preserve ∏ r_j from BEFORE the complete-set
  // mint (not from the scaled-up state). Verify with BigInt math.
  const reserves = [500, 500, 500];
  const q = multiBuyQuote(reserves, 1, 75);
  // Reserves-after in raw BigInt
  const raw = q.reservesAfterRaw;
  const prodAfter = raw[0] * raw[1] * raw[2];
  const prodBefore = toRaw(500) * toRaw(500) * toRaw(500);
  // ceilDiv rounds UP → product-after is ≥ product-before by at most a few units.
  assert.ok(prodAfter >= prodBefore,
    `invariant preserved (≥) — after=${prodAfter} before=${prodBefore}`);
  // Tolerance: a tiny positive drift from ceilDiv, bounded by (r_m+C)(r_n+C).
  const maxDrift = (raw[0]) * (raw[2]);  // loose upper bound
  assert.ok(prodAfter - prodBefore <= maxDrift, 'rounding drift bounded');
});

test('multiSellQuote (N=3): round-trip — buy then sell recovers ~net', () => {
  // Buy 100 MXNP of outcome 0, then sell all shares back.
  // Due to the buy fee (≈3.33% at 1/3) the user recovers only the NET
  // collateral — the fee stays with the pool as accumulated LP value.
  // Reserves return exactly to the pre-buy state because both operations
  // preserve the CPMM invariant and the sell has no fee.
  const reserves = [500, 500, 500];
  const buy = multiBuyQuote(reserves, 0, 100);
  const sell = multiSellQuote(buy.reservesAfter, 0, buy.sharesOut);

  // Recovered collateral ≈ buy.collateral − buy.fee = 100 − 3.33 = 96.67.
  approxEqual(sell.collateralOut, 100 - buy.fee, 0.02,
    'sell recovers net-of-fee collateral');

  // After round-trip reserves snap back to [500, 500, 500] (the fee never
  // made it into reserves — it's held as an implicit pool-MXNP surplus
  // not tracked in the reserves vector).
  const postRoundTrip = sell.reservesAfter;
  approxEqual(postRoundTrip[0], 500, 0.02, 'sold reserve returns to seed');
  approxEqual(postRoundTrip[1], 500, 0.02, 'untouched reserves return to seed');
  approxEqual(postRoundTrip[2], 500, 0.02, 'untouched reserves return to seed');
});

test('multiSellQuote (N=3): Newton converges on skewed pool', () => {
  // Skewed starting pool + large sell — stresses the iteration.
  const reserves = [120, 480, 480]; // outcome 0 is mid-price (~55%)
  // Someone holds 200 shares of outcome 0 after heavy buying; selling them.
  const sell = multiSellQuote(reserves, 0, 200);

  assert.ok(sell.collateralOut > 0, 'sell returns positive MXNP');
  // Sell should push the price down (outcome gets cheaper).
  assert.ok(sell.priceAfter < sell.priceBefore,
    `sell depresses price — before=${sell.priceBefore} after=${sell.priceAfter}`);
  // All reserves remain positive.
  for (const r of sell.reservesAfter) {
    assert.ok(r > 0, `reserve stays positive — got ${r}`);
  }
  // Post-trade prices still sum to 1.
  approxEqual(sell.pricesAfter.reduce((s, p) => s + p, 0), 1, 0.0001,
    'post-sell prices sum to 1');
});

test('multiSellQuote (N=3): massive sell on shallow pool produces terrible price (never nonsense)', () => {
  // A huge sell relative to pool depth should still solve — Newton finds
  // a root in (0, min_other_reserve) for any positive α. The resulting
  // price is awful (most of the shares are effectively worthless), but
  // the math never returns invalid state. Mirrors the binary "absurdly
  // large sell" test.
  const sell = multiSellQuote([100, 50, 50], 0, 1000);

  // Average price must be much lower than the starting ~20% — roughly
  // 35 MXNP recovered for 1000 shares means ~3.5¢ apiece.
  const avgPrice = sell.collateralOut / 1000;
  assert.ok(avgPrice < 0.05,
    `huge sell avg price should be < 5¢ — got ${avgPrice}`);
  // Reserves still positive (sell never drains the pool as long as the
  // root is strictly below min(other reserves)).
  for (const r of sell.reservesAfter) {
    assert.ok(r > 0, `reserve stays positive — got ${r}`);
  }
  // Prices still sum to ~1.
  approxEqual(sell.pricesAfter.reduce((s, p) => s + p, 0), 1, 0.01,
    'prices still sum to ~1 after extreme trade');
});

test('multiSellQuote (N=3): rejects when pool is degenerate (one reserve is zero)', () => {
  // If somehow a reserve hits zero, the multiplicative invariant becomes
  // singular. The math must reject rather than silently return garbage.
  assert.throws(
    () => multiSellQuote([500, 0, 500], 0, 10),
    /empty reserves|drain/,
    'degenerate pool must throw',
  );
});

test('multiBuyQuote (N=3): fee scales inversely with outcome price', () => {
  // At a skewed pool, buying the cheap side pays more fee %,
  // buying the expensive side pays less.
  const reserves = [100, 500, 500];
  const priceCheap = multiPrices(reserves)[1]; // outcome 1 is "cheap" (~22%)
  const priceExpensive = multiPrices(reserves)[0]; // outcome 0 is "expensive" (~55%)
  assert.ok(priceExpensive > priceCheap);

  const qCheap = multiBuyQuote(reserves, 1, 50);
  const qExpensive = multiBuyQuote(reserves, 0, 50);
  // fee% = 5 × (1 − P_bought).
  assert.ok(qCheap.feePct > qExpensive.feePct,
    `cheap outcome pays more fee% — cheap=${qCheap.feePct} exp=${qExpensive.feePct}`);
});

test('multiBuyQuote: N=2 matches binary within tolerance', () => {
  // Sanity check: the multi code reduces to binary behavior for N=2.
  // Binary code path remains canonical (audited), but math should agree.
  const binary = binaryBuyQuote([500, 500], 0, 100);
  const multi = multiBuyQuote([500, 500], 0, 100);
  approxEqual(multi.sharesOut, binary.sharesOut, 0.001,
    'multi(N=2) ≈ binary sharesOut');
  approxEqual(multi.fee, binary.fee, 0.001, 'multi(N=2) ≈ binary fee');
  approxEqual(multi.priceAfter, binary.priceAfter, 0.001,
    'multi(N=2) ≈ binary priceAfter');
});

test('multi N=3 end-to-end: W/D/L soccer market, Mexico wins', () => {
  // Seeded at [500, 500, 500] for Mexico / Tie / Opponent.
  // Alice buys 100 MXNP of Mexico YES. Bob buys 60 of Tie.
  // Market resolves: Mexico wins (outcome 0). Alice redeems, Bob loses.
  let reserves = [500, 500, 500];

  const alice = multiBuyQuote(reserves, 0, 100);
  reserves = alice.reservesAfter;
  console.log(`  ↳ Alice bought ${alice.sharesOut.toFixed(2)} Mexico shares @ ${alice.avgPrice.toFixed(3)}`);

  const bob = multiBuyQuote(reserves, 1, 60);
  reserves = bob.reservesAfter;
  console.log(`  ↳ Bob bought ${bob.sharesOut.toFixed(2)} Tie shares @ ${bob.avgPrice.toFixed(3)}`);

  // Resolution: Mexico wins. Alice's shares pay 1 MXNP each, Bob's pay 0.
  const aliceWinnings = redeemPayout(alice.sharesOut, 0, 0);
  const bobWinnings   = redeemPayout(bob.sharesOut,   1, 0);

  assert.equal(bobWinnings, 0, 'Bob loses Tie bet');
  assert.ok(aliceWinnings > 100,
    `Alice profits on Mexico win — got ${aliceWinnings} for 100 staked`);
  console.log(`  ↳ Alice payout: +${(aliceWinnings - 100).toFixed(2)} MXNP net`);
});
