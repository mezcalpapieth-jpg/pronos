import assert from 'node:assert/strict';
import test from 'node:test';
import { binaryBuyQuote, binarySellQuote, multiBuyQuote, multiPrices, multiSellQuote } from './amm-math.js';
import { fundingAmount, LIQUIDITY_TARGETS, marketFundingPreview, planMarketFunding, recommendMarketFunding } from './market-funding.js';

export const BALLON_RESERVES = [319.139211, 11.707936, 2619.071733, 2619.071733, 2619.071733, 115.646882, 2619.071733, 3346.351733, 3346.351733];
const near = (a, b, tolerance = 0.000003) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('reproduces the Ballon d Or 100 MXNP buy from 9c to 90c', () => {
  const quote = multiBuyQuote(BALLON_RESERVES, 5, 100);
  near(quote.priceBefore, 0.087064);
  near(quote.priceAfter, 0.900918);
});

test('reproduces the observed Mbappe fill and resulting live reserve snapshot', () => {
  const before = [223.492911, 118.878586, 2523.425433, 2523.425433, 2523.425433,
    20.000582, 2523.425433, 3250.705433, 3250.705433];
  const quote = multiBuyQuote(before, 1, 100);
  near(quote.priceBefore, 0.129244);
  near(quote.priceAfter, 0.859990);
  near(quote.sharesOut, 202.816950);
  near(quote.fee, 4.353700);
  for (let i = 0; i < before.length; i++) near(quote.reservesAfter[i], BALLON_RESERVES[i]);
});

test('proportional funding keeps odds and accounts for every complete-set share', () => {
  for (const reserves of [[910, 90], [500, 750, 250], BALLON_RESERVES]) {
    const original = [...reserves];
    const plan = planMarketFunding(reserves, 10000);
    assert.deepEqual(reserves, original);
    for (let i = 0; i < reserves.length; i++) {
      assert.ok(plan.reservesAfter[i] > reserves[i]);
      near(plan.reservesAfter[i] / reserves[i], plan.scaleFactor, 0.000001);
      near(plan.pricesBefore[i], plan.pricesAfter[i]);
      near(plan.amountsAdded[i] + plan.retainedShares[i], 10000);
      near(plan.reservesAfter[i] - reserves[i], plan.amountsAdded[i]);
      assert.ok(plan.retainedShares[i] >= 0);
    }
    near(plan.pricesAfter.reduce((a, b) => a + b, 0), 1, 0.00001);
  }
});

test('recommendation protects every candidate, not only the selected or leading one', () => {
  const recommended = recommendMarketFunding(BALLON_RESERVES);
  assert.equal(recommended, 493060);
  const preview = marketFundingPreview(BALLON_RESERVES, recommended);
  assert.equal(preview.testBuy, 500);
  assert.deepEqual(preview.targets.map(({ collateral, maxImpactPts }) => ({ collateral, maxImpactPts })), LIQUIDITY_TARGETS);
  for (const target of preview.targets) assert.ok(target.impactsAfter.every(row => row.impactPts <= target.maxImpactPts));
  near(preview.impactsAfter[5].priceBefore, 0.087064);
  assert.ok(marketFundingPreview(BALLON_RESERVES, recommended - 1).targets.some(target => target.impactsAfter.some(row => row.impactPts > target.maxImpactPts)));
});

test('Roma draw Madrid reversal is controlled at both reference sizes without moving odds', () => {
  const reserves = [2709.692091, 138.659066, 2661.532817];
  const original = multiBuyQuote(reserves, 2, 1700);
  near(original.priceBefore, 0.047220);
  near(original.priceAfter, 0.909839);
  const amount = recommendMarketFunding(reserves);
  assert.equal(amount, 18953);
  const preview = marketFundingPreview(reserves, amount);
  for (const target of preview.targets) assert.ok(target.impactsAfter.every(row => row.impactPts <= target.maxImpactPts));
  for (let i = 0; i < reserves.length; i++) near(preview.plan.pricesBefore[i], preview.plan.pricesAfter[i]);
  assert.ok(multiBuyQuote(preview.plan.reservesAfter, 2, 1700).priceAfter < 0.24);
});

test('100 MXNP alone no longer qualifies an otherwise shallow pool as healthy', () => {
  const preview = marketFundingPreview([1000, 1000]);
  assert.ok(binaryBuyQuote([1000, 1000], 0, 100).priceImpactPts < 5);
  assert.ok(preview.recommendedAmount > 0);
  const funded = marketFundingPreview([1000, 1000], preview.recommendedAmount);
  for (const target of funded.targets) assert.ok(target.impactsAfter.every(row => row.impactPts <= target.maxImpactPts));
});

test('deep pools need no additional funding and targets beyond the safety cap are explicit', () => {
  assert.equal(recommendMarketFunding([100000, 100000, 100000]), 0);
  assert.equal(recommendMarketFunding([10000000, 1, 1]), null);
});

test('funding rejects invalid, negative, excessive and precision-erasing inputs', () => {
  for (const amount of [null, undefined, '', true, NaN, Infinity, -1, 0, 0.5, 10000001]) {
    assert.throws(() => fundingAmount(amount), /invalid_funding_amount/);
  }
  for (const reserves of [[], [1], [1, 0], [1, NaN], [1, -2], [true, 10], [1, 0.0000001]]) {
    assert.throws(() => planMarketFunding(reserves, 100), /invalid_funding_reserves/);
  }
  assert.throws(() => planMarketFunding([10000000, 10000000], 1), /funded_reserve_too_large/);
  assert.throws(() => planMarketFunding([1000000, 0.000001], 1), /funding_too_small/);
});

test('post-funding immediate buys and sells cannot manufacture profit', () => {
  for (const reserves of [[910, 90], [500, 750, 250], BALLON_RESERVES]) {
    const funded = planMarketFunding(reserves, 100000).reservesAfter;
    const buy = reserves.length === 2 ? binaryBuyQuote : multiBuyQuote;
    const sell = reserves.length === 2 ? binarySellQuote : multiSellQuote;
    for (let outcome = 0; outcome < reserves.length; outcome++) {
      for (const amount of [1, 100, 1000]) {
        const bought = buy(funded, outcome, amount);
        const sold = sell(bought.reservesAfter, outcome, bought.sharesOut);
        assert.ok(sold.collateralOut <= amount - bought.fee + 0.000003);
        for (let i = 0; i < funded.length; i++) near(sold.reservesAfter[i], funded[i], 0.000005);
      }
    }
  }
});

test('funded multi-outcome prices stay normalized through a sequence of competing buys', () => {
  let reserves = planMarketFunding(BALLON_RESERVES, 100000).reservesAfter;
  for (let i = 0; i < 30; i++) {
    reserves = multiBuyQuote(reserves, i % reserves.length, 100).reservesAfter;
    const probabilities = multiPrices(reserves);
    near(probabilities.reduce((a, b) => a + b, 0), 1, 0.00001);
    assert.ok(probabilities.every(value => value > 0 && value < 1));
  }
});
