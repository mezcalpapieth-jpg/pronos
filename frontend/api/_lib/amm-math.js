/**
 * AMM math for the off-chain points app.
 *
 * Server-side equivalent of the audited on-chain PronosAMM.sol, in JS
 * with BigInt so we can run the same economic model without contracts.
 *
 * Scope: BINARY markets only (outcome_index ∈ {0, 1}). Multi-outcome
 * markets are modeled as N parallel binary markets — same pattern
 * Polymarket uses for N-candidate elections. This keeps the math
 * identical to the audited binary CPMM and avoids reimplementing a
 * multi-outcome AMM whose invariants are subtle.
 *
 * Precision:
 *   - All collateral / reserve amounts scaled by 1e6 (6 decimals, matches
 *     USDC). A value of 500_000_000n represents 500 MXNP.
 *   - All share amounts use the same 6-decimal scale.
 *   - Prices are probability × 1e6 (500_000 = 50%).
 *
 * Conventions:
 *   - "Raw" = BigInt in 1e6 units.
 *   - "Human" = JavaScript number with up to 6 decimal places.
 *   - Exported functions accept Human input and return Human output.
 *   - Internal intermediates use BigInt.
 *
 * Fee model (modified from PronosAMM.sol — buys only):
 *   Buys charge a dynamic fee: fee% = 5 × (1 − P_bought_side)
 *     P = 0.5  → 2.5% fee
 *     P = 0.9  → 0.5% fee
 *     P = 0.99 → 0.05% fee
 *   Sells have NO FEE. Users get the full CPMM quadratic-formula
 *   output back as collateral.
 *
 *   This deviates from the on-chain contract (which also charges
 *   a sell fee). The deviation is intentional for the points-app:
 *   simpler UX, easier to explain, and the "spread" is already
 *   baked into the buy price via the CPMM curve.
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const SCALE = 1_000_000n;              // 1e6 — matches USDC/MXNP 6 decimals
const PRICE_SCALE = 1_000_000n;        // probabilities stored as ×1e6
const FEE_SLOPE_BPS = 500n;            // fee = 5% × (1 - P)
const FEE_DENOM = 10_000n;             // bps denominator
const DEFAULT_FEE_AT_FIFTY = 25_000n;  // 2.5% in 1e6 — used when pool is empty

// ─── Conversions ─────────────────────────────────────────────────────────────
export function toRaw(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') value = Number(value);
  if (!Number.isFinite(value)) throw new Error(`amm-math: invalid numeric input: ${value}`);
  // Round half-up to 6 decimals then convert to BigInt.
  return BigInt(Math.round(Number(value) * 1_000_000));
}

export function fromRaw(value) {
  if (typeof value !== 'bigint') value = BigInt(value);
  return Number(value) / 1_000_000;
}

function rawToProbability(priceRaw) {
  return Number(priceRaw) / Number(PRICE_SCALE);
}

// ─── BigInt helpers ──────────────────────────────────────────────────────────
function sqrtBig(value) {
  if (value < 0n) throw new Error('amm-math: sqrt of negative');
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

function ceilDiv(a, b) {
  if (b === 0n) throw new Error('amm-math: ceilDiv by zero');
  return (a + b - 1n) / b;
}

function absDiff(a, b) {
  return a > b ? a - b : b - a;
}

// ─── Fee model (matches PronosAMM.sol calculateFee) ──────────────────────────
/**
 * Compute the fee on `amount` given the current reserve state. `buyContext`
 * picks which side's probability drives the fee rate:
 *   - buyContext = true  → fee rate uses P(YES) = reserveNo / (reserveYes + reserveNo)
 *   - buyContext = false → fee rate uses P(NO)  = reserveYes / (reserveYes + reserveNo)
 */
export function calculateFeeRaw(amountRaw, reserveYesRaw, reserveNoRaw, buyContext) {
  const total = reserveYesRaw + reserveNoRaw;
  if (total === 0n) {
    return (amountRaw * DEFAULT_FEE_AT_FIFTY) / SCALE;
  }
  const p = buyContext
    ? (reserveNoRaw * PRICE_SCALE) / total
    : (reserveYesRaw * PRICE_SCALE) / total;
  const feeRate = (FEE_SLOPE_BPS * (PRICE_SCALE - p)) / FEE_DENOM;
  return (amountRaw * feeRate) / SCALE;
}

// ─── Binary CPMM (mirrors PronosAMM.sol) ─────────────────────────────────────
/**
 * Quote a buy of `collateral` MXNP on the given outcome (0 = YES, 1 = NO).
 * Pure function — does NOT mutate reserves. Returns human-readable fields
 * plus the BigInt reserves-after so callers can persist the new state.
 */
export function binaryBuyQuote(reservesHuman, outcome, collateralHuman) {
  if (collateralHuman <= 0) throw new Error('amm-math: collateral must be > 0');
  const buyYes = outcome === 0;

  let reserveYes = toRaw(reservesHuman[0]);
  let reserveNo  = toRaw(reservesHuman[1]);
  const collateralRaw = toRaw(collateralHuman);

  // Fee charged on gross collateral, side = the one being bought
  const feeRaw = calculateFeeRaw(collateralRaw, reserveYes, reserveNo, buyYes);
  const netRaw = collateralRaw - feeRaw;

  // Mint a complete set with netRaw — each reserve grows by netRaw,
  // but the CPMM invariant uses k from BEFORE the mint (matches contract).
  const k = reserveYes * reserveNo;

  let sharesOutRaw;
  let newReserveYes;
  let newReserveNo;

  if (buyYes) {
    const newNo = reserveNo + netRaw;
    const newYes = newNo === 0n ? 0n : ceilDiv(k, newNo); // round up to protect pool
    sharesOutRaw = (reserveYes + netRaw) - newYes;
    newReserveYes = newYes;
    newReserveNo  = newNo;
  } else {
    const newYes = reserveYes + netRaw;
    const newNo = newYes === 0n ? 0n : ceilDiv(k, newYes);
    sharesOutRaw = (reserveNo + netRaw) - newNo;
    newReserveYes = newYes;
    newReserveNo  = newNo;
  }

  if (sharesOutRaw <= 0n) {
    throw new Error('amm-math: trade too small or reserves invalid');
  }

  const totalBefore = reserveYes + reserveNo || 1n;
  const pYesBefore = (reserveNo * PRICE_SCALE) / totalBefore;
  const pNoBefore  = (reserveYes * PRICE_SCALE) / totalBefore;
  const totalAfter = newReserveYes + newReserveNo;
  const pYesAfter = totalAfter === 0n ? 0n : (newReserveNo * PRICE_SCALE) / totalAfter;
  const pNoAfter  = totalAfter === 0n ? 0n : (newReserveYes * PRICE_SCALE) / totalAfter;

  const pricesBefore = [rawToProbability(pYesBefore), rawToProbability(pNoBefore)];
  const pricesAfter  = [rawToProbability(pYesAfter),  rawToProbability(pNoAfter)];

  return {
    collateral: fromRaw(collateralRaw),
    fee: fromRaw(feeRaw),
    feePct: collateralHuman > 0 ? (fromRaw(feeRaw) / collateralHuman) * 100 : 0,
    sharesOut: fromRaw(sharesOutRaw),
    avgPrice: sharesOutRaw === 0n ? 0 : fromRaw(netRaw) / fromRaw(sharesOutRaw),
    priceBefore: pricesBefore[outcome],
    priceAfter: pricesAfter[outcome],
    priceImpactPts: (pricesAfter[outcome] - pricesBefore[outcome]) * 100,
    pricesBefore,
    pricesAfter,
    reservesAfter: [fromRaw(newReserveYes), fromRaw(newReserveNo)],
    reservesAfterRaw: [newReserveYes, newReserveNo],
  };
}

/**
 * Quote a sell of `shares` tokens of the given outcome back to the pool.
 *
 * Math (CPMM sell — zero fee by design):
 *   User sends `s` tokens of side A. Pool merges `c` complete sets into
 *   collateral by consuming c of A's reserve AND c of B's reserve.
 *   After: (R_a + s − c) × (R_b − c) = k_pre
 *   Solving: c = [(a + b) − √((a − b)² + 4k)] / 2
 *   where a = R_a + s, b = R_b.
 *
 * The full `c` value is returned to the user as collateralOut.
 * We still expose `fee: 0` and `feePct: 0` in the shape so callers
 * don't have to special-case the return type.
 */
export function binarySellQuote(reservesHuman, outcome, sharesHuman) {
  if (sharesHuman <= 0) throw new Error('amm-math: shares must be > 0');
  const sellYes = outcome === 0;

  let reserveYes = toRaw(reservesHuman[0]);
  let reserveNo  = toRaw(reservesHuman[1]);
  const sharesRaw = toRaw(sharesHuman);

  const k = reserveYes * reserveNo;
  let a, b;
  if (sellYes) {
    a = reserveYes + sharesRaw;
    b = reserveNo;
  } else {
    a = reserveNo + sharesRaw;
    b = reserveYes;
  }
  const diff = absDiff(a, b);
  const discriminant = diff * diff + 4n * k;
  const c = (a + b - sqrtBig(discriminant)) / 2n;

  if (c <= 0n) {
    throw new Error('amm-math: sell too small');
  }
  if (c >= b) {
    // Would drain the opposite reserve to zero — degenerate pool state.
    throw new Error('amm-math: sell would drain pool');
  }

  // No sell fee — user receives full c.
  const collateralOutRaw = c;

  const newReserveYes = sellYes ? a - c : b - c;
  const newReserveNo  = sellYes ? b - c : a - c;

  const totalBefore = reserveYes + reserveNo || 1n;
  const pYesBefore = (reserveNo * PRICE_SCALE) / totalBefore;
  const pNoBefore  = (reserveYes * PRICE_SCALE) / totalBefore;
  const totalAfter = newReserveYes + newReserveNo;
  const pYesAfter = totalAfter === 0n ? 0n : (newReserveNo * PRICE_SCALE) / totalAfter;
  const pNoAfter  = totalAfter === 0n ? 0n : (newReserveYes * PRICE_SCALE) / totalAfter;

  const pricesBefore = [rawToProbability(pYesBefore), rawToProbability(pNoBefore)];
  const pricesAfter  = [rawToProbability(pYesAfter),  rawToProbability(pNoAfter)];

  return {
    shares: fromRaw(sharesRaw),
    gross: fromRaw(c),
    fee: 0,
    feePct: 0,
    collateralOut: fromRaw(collateralOutRaw),
    priceBefore: pricesBefore[outcome],
    priceAfter: pricesAfter[outcome],
    priceImpactPts: (pricesAfter[outcome] - pricesBefore[outcome]) * 100,
    pricesBefore,
    pricesAfter,
    reservesAfter: [fromRaw(newReserveYes), fromRaw(newReserveNo)],
    reservesAfterRaw: [newReserveYes, newReserveNo],
  };
}

// ─── Binary price helper ─────────────────────────────────────────────────────
export function binaryPrices(reservesHuman) {
  const reserveYes = toRaw(reservesHuman[0]);
  const reserveNo  = toRaw(reservesHuman[1]);
  const total = reserveYes + reserveNo;
  if (total === 0n) return [0.5, 0.5];
  const pYesRaw = (reserveNo * PRICE_SCALE) / total;
  return [rawToProbability(pYesRaw), 1 - rawToProbability(pYesRaw)];
}

// ─── Redemption (on a resolved market) ───────────────────────────────────────
/**
 * On a resolved market, each winning share pays out 1 MXNP. Losing shares
 * are worth 0. This is the off-chain equivalent of PronosAMM.redeem().
 */
export function redeemPayout(shares, outcomeIndex, winningOutcomeIndex) {
  if (outcomeIndex !== winningOutcomeIndex) return 0;
  return Math.max(0, Number(shares) || 0);
}

// ─── Utility: initial reserves for a new market ──────────────────────────────
/**
 * Initial reserves for a new market with `outcomeCount` outcomes, all
 * priced equally.
 *   - Binary (N=2): [S, S] — 50/50, matches PronosAMM.initialize().
 *   - Multi (N>2): [S, S, S, ...] — each outcome starts at 1/N implied
 *     probability under the inverse-reserve weighting used by
 *     pricesFromReserves in markets.js.
 *
 * Trading endpoints (`buy`, `sell`) still only support binary (N=2);
 * multi-outcome markets currently render as read-only in the UI until the
 * AMM math for N>2 is wired up.
 */
export function initialReserves(seedHuman, outcomeCount = 2) {
  const n = Math.max(2, Math.min(20, Number(outcomeCount) || 2));
  return Array.from({ length: n }, () => seedHuman);
}

// ─── Multi-outcome markets: grouped binary markets ───────────────────────────
// For markets with N > 2 outcomes (e.g. "Who wins the World Cup?" with 32
// teams), we model each candidate as a separate binary market:
//   "Will team X win?" — YES / NO
// This is the same pattern Polymarket uses for elections. It keeps the
// math identical to the audited binary CPMM and lets winning shares on
// the losing teams naturally expire worthless. The only extra logic is
// at the UI layer: group the N binary markets under one parent "event".

// Exported for tests
export const _internal = {
  SCALE,
  PRICE_SCALE,
  sqrtBig,
  ceilDiv,
};
