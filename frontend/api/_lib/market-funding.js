import { binaryBuyQuote, binaryPrices, multiBuyQuote, multiPrices, toRaw, fromRaw } from './amm-math.js';

export const MAX_FUNDING_AMOUNT = 10_000_000;
export const MAX_FUNDED_RESERVE = 10_000_000;
export const LIQUIDITY_TEST_BUY = 500;
export const LIQUIDITY_TARGET_IMPACT = 5;
export const LIQUIDITY_TARGETS = Object.freeze([
  Object.freeze({ collateral: LIQUIDITY_TEST_BUY, maxImpactPts: LIQUIDITY_TARGET_IMPACT }),
  Object.freeze({ collateral: 1000, maxImpactPts: 10 }),
]);

function invalid(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

export function fundingReserves(values) {
  if (!Array.isArray(values) || values.length < 2 || values.length > 20
    || values.some(value => !['number', 'string'].includes(typeof value)
      || !Number.isFinite(Number(value)) || Number(value) <= 0)) {
    invalid('invalid_funding_reserves');
  }
  const raw = values.map(toRaw);
  if (raw.some(value => value <= 0n)) invalid('invalid_funding_reserves');
  return raw.map(fromRaw);
}

export function fundingAmount(value) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') invalid('invalid_funding_amount');
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_FUNDING_AMOUNT) invalid('invalid_funding_amount');
  return fromRaw(toRaw(amount));
}

const prices = values => (values.length === 2 ? binaryPrices : multiPrices)(values);

// Add a complete set, retaining only proportional inventory in the pool.
// The remaining outcome shares belong to the system funder, not traders.
export function planMarketFunding(reserves, amount) {
  const before = fundingReserves(reserves);
  const collateral = fundingAmount(amount);
  const raw = before.map(toRaw);
  const funds = toRaw(collateral);
  const largest = raw.reduce((max, value) => value > max ? value : max, 0n);
  const added = raw.map(value => value * funds / largest);
  if (added.some(value => value <= 0n)) invalid('funding_too_small');
  const after = raw.map((value, index) => value + added[index]);
  if (after.some(value => value > toRaw(MAX_FUNDED_RESERVE))) invalid('funded_reserve_too_large');
  const pricesBefore = prices(before);
  const reservesAfter = after.map(fromRaw);
  const pricesAfter = prices(reservesAfter);
  if (pricesAfter.some((price, i) => Math.abs(price - pricesBefore[i]) > 0.000002)) invalid('funding_rounding_too_large');
  return {
    collateral, scaleFactor: 1 + collateral / fromRaw(largest),
    reservesBefore: before, reservesAfter, pricesBefore, pricesAfter,
    amountsAdded: added.map(fromRaw),
    retainedShares: added.map(value => fromRaw(funds - value)),
  };
}

export function marketBuyImpacts(reserves, collateral = LIQUIDITY_TEST_BUY) {
  const values = fundingReserves(reserves);
  return values.map((_, outcomeIndex) => {
    const quote = (values.length === 2 ? binaryBuyQuote : multiBuyQuote)(values, outcomeIndex, collateral);
    return { outcomeIndex, priceBefore: quote.priceBefore, priceAfter: quote.priceAfter,
      impactPts: quote.priceImpactPts, sharesOut: quote.sharesOut, fee: quote.fee };
  });
}

export function recommendMarketFunding(reserves) {
  const before = fundingReserves(reserves);
  const meetsTargets = values => LIQUIDITY_TARGETS.every(target =>
    marketBuyImpacts(values, target.collateral).every(row => row.impactPts <= target.maxImpactPts));
  if (meetsTargets(before)) return 0;
  const max = Math.floor(Math.min(MAX_FUNDING_AMOUNT, MAX_FUNDED_RESERVE - Math.max(...before)));
  if (max < 1 || !meetsTargets(planMarketFunding(before, max).reservesAfter)) return null;
  let lo = 1;
  let hi = max;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (meetsTargets(planMarketFunding(before, mid).reservesAfter)) hi = mid;
    else lo = mid + 1;
  }
  return hi;
}

export function marketFundingPreview(reserves, amount = null) {
  const before = fundingReserves(reserves);
  const recommendedAmount = recommendMarketFunding(before);
  const plan = amount == null ? null : planMarketFunding(before, amount);
  return {
    reserves: before, prices: prices(before), testBuy: LIQUIDITY_TEST_BUY,
    targetImpactPts: LIQUIDITY_TARGET_IMPACT, recommendedAmount,
    impactsBefore: marketBuyImpacts(before),
    plan, impactsAfter: plan ? marketBuyImpacts(plan.reservesAfter) : null,
    targets: LIQUIDITY_TARGETS.map(target => ({ ...target,
      impactsBefore: marketBuyImpacts(before, target.collateral),
      impactsAfter: plan ? marketBuyImpacts(plan.reservesAfter, target.collateral) : null,
    })),
  };
}
