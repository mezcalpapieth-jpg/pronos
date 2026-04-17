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

// ─── Multi-outcome markets ───────────────────────────────────────────────────
//
// Product decision: we handle non-binary markets in TWO regimes based on
// outcome count:
//
//   N = 3 (unified pool)
//     Typical use: soccer W/D/L, three-way elections. The pool holds one
//     reserve per outcome; invariant is the product ∏ r_j. Prices sum to
//     100% naturally. Buy is closed-form (one BigInt division); sell is a
//     Newton-iteration on a cubic polynomial (converges in ~5 iters).
//
//   N ≥ 4 (parallel binary markets)
//     Typical use: "who wins" among many candidates (Liga MX, Mundial
//     brackets). Each outcome becomes its own binary market row sharing
//     an event_group_id. Reuses the audited binary CPMM verbatim. This
//     module does NOT implement that path — the wiring lives in
//     create-market.js, markets.js, and resolve-market.js. The trading
//     endpoints still dispatch to binaryBuyQuote/binarySellQuote for
//     each leg.
//
// The functions below cover the N=3 unified case. They're written to work
// for any N ≥ 2 so tests can cross-check N=2 against binaryBuyQuote for
// mathematical sanity, but trading endpoints route N=2 through the
// audited binary code path to minimize blast radius.

/**
 * Raw (1e6-scaled BigInt) price of outcome `idx` in an N-outcome pool.
 *   P_i = (∏_{j≠i} r_j) / Σ_k (∏_{j≠k} r_j)
 *
 * Preconditions: `reservesRaw` is a BigInt[] with length ≥ 2 and every
 * element > 0n. Callers MUST validate before calling. Preconditions are
 * documented (not enforced via null/undefined sentinels) so bundler
 * type-flow analysis never sees a BigInt|null union for this return.
 */
export function multiPriceRaw(reservesRaw, idx) {
  // ∏_{j≠idx} r_j in (1e6)^{N-1} scale.
  let num = 1n;
  for (let j = 0; j < reservesRaw.length; j++) {
    if (j !== idx) num = num * reservesRaw[j];
  }

  // Σ_k (∏_{j≠k} r_j). Factor trick: each term = (∏ r) / r_k.
  let fullProduct = 1n;
  for (const r of reservesRaw) fullProduct = fullProduct * r;
  let denom = 0n;
  for (const r of reservesRaw) denom = denom + fullProduct / r;

  return (num * PRICE_SCALE) / denom;
}

/**
 * Human-readable price vector for a multi-outcome pool. Sums to ~1.0
 * (may be off by a microprobability due to BigInt truncation on small
 * reserves, negligible in practice). Falls back to a uniform 1/N prior
 * on degenerate input so the UI never divides by zero.
 */
export function multiPrices(reservesHuman) {
  if (!Array.isArray(reservesHuman) || reservesHuman.length < 2) {
    return [0.5, 0.5];
  }
  const n = reservesHuman.length;
  const raw = reservesHuman.map(toRaw);

  // Early uniform-prior return for degenerate pools. Separate branch so
  // multiPriceRaw is only ever called with validated BigInt inputs.
  for (let i = 0; i < n; i++) {
    if (raw[i] <= 0n) {
      const uniform = 1 / n;
      return new Array(n).fill(uniform);
    }
  }

  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = rawToProbability(multiPriceRaw(raw, i));
  }
  return out;
}

/**
 * Dynamic fee on a buy in an N-outcome pool. Same shape as binary:
 *   fee% = 5% × (1 − P_bought)
 * At the 1/N symmetric starting price, that's 5% × (1 − 1/N):
 *   N=2 → 2.50%  (matches binary)
 *   N=3 → 3.33%
 *   N=4 → 3.75%
 *
 * Caller guarantees valid reservesRaw (BigInt[] with all > 0n).
 */
function calculateMultiFeeRaw(amountRaw, reservesRaw, outcomeIdx) {
  const pRaw = multiPriceRaw(reservesRaw, outcomeIdx);
  const feeRate = (FEE_SLOPE_BPS * (PRICE_SCALE - pRaw)) / FEE_DENOM;
  return (amountRaw * feeRate) / SCALE;
}

/**
 * Quote a buy of `collateral` MXNP on outcome `outcomeIdx` in an N-outcome
 * pool. Closed-form solution.
 *
 * Math:
 *   User pays C collateral → pool mints a complete set (all reserves +C).
 *   Pool trades α shares of outcome i to user, preserving the invariant
 *   from BEFORE the mint:
 *     (r_i + C − α) · ∏_{j≠i}(r_j + C) = ∏_j r_j = K
 *   Solve:
 *     α = r_i + C − K / ∏_{j≠i}(r_j + C)
 *
 * Pool-safe rounding: new reserve i is computed via ceilDiv (rounded UP)
 * so the user receives fewer shares if there's a fractional boundary —
 * same convention as binaryBuyQuote.
 */
export function multiBuyQuote(reservesHuman, outcomeIdx, collateralHuman) {
  if (!Array.isArray(reservesHuman) || reservesHuman.length < 2) {
    throw new Error('amm-math: multi-outcome needs ≥ 2 reserves');
  }
  if (outcomeIdx < 0 || outcomeIdx >= reservesHuman.length) {
    throw new Error('amm-math: outcome_index out of range');
  }
  if (collateralHuman <= 0) throw new Error('amm-math: collateral must be > 0');

  const reserves = reservesHuman.map(toRaw);
  const n = reserves.length;
  if (reserves.some(r => r <= 0n)) {
    throw new Error('amm-math: empty reserves');
  }

  const collateralRaw = toRaw(collateralHuman);
  const feeRaw = calculateMultiFeeRaw(collateralRaw, reserves, outcomeIdx);
  const netRaw = collateralRaw - feeRaw;

  // K_pre = ∏_j r_j (kept from BEFORE the complete-set mint).
  let K = 1n;
  for (const r of reserves) K = K * r;

  // Denom = ∏_{j≠i} (r_j + net)
  let denom = 1n;
  for (let j = 0; j < n; j++) {
    if (j !== outcomeIdx) denom = denom * (reserves[j] + netRaw);
  }

  // new r_i after the trade. ceilDiv so we round UP → user gets fewer
  // shares (safer for pool).
  const newReserveI = ceilDiv(K, denom);
  const sharesOutRaw = (reserves[outcomeIdx] + netRaw) - newReserveI;
  if (sharesOutRaw <= 0n) {
    throw new Error('amm-math: trade too small or reserves invalid');
  }

  // Compose the post-trade reserves vector.
  const newReservesRaw = reserves.map((r, j) =>
    j === outcomeIdx ? newReserveI : r + netRaw,
  );

  // Both vectors are guaranteed to be fully-positive BigInt[] at this
  // point (checked above for `reserves`; `newReserveI` is ceilDiv'd
  // from a positive K, and other slots are `r + netRaw` where netRaw
  // ≤ collateralRaw is non-negative), so we can call multiPriceRaw
  // without another guard. Allocated explicitly (no `|| fallback`) to
  // keep every intermediate typed BigInt, never BigInt|null.
  const pricesBefore = new Array(n);
  const pricesAfter = new Array(n);
  for (let i = 0; i < n; i++) {
    pricesBefore[i] = rawToProbability(multiPriceRaw(reserves, i));
    pricesAfter[i] = rawToProbability(multiPriceRaw(newReservesRaw, i));
  }

  return {
    collateral: fromRaw(collateralRaw),
    fee: fromRaw(feeRaw),
    feePct: collateralHuman > 0 ? (fromRaw(feeRaw) / collateralHuman) * 100 : 0,
    sharesOut: fromRaw(sharesOutRaw),
    avgPrice: sharesOutRaw === 0n ? 0 : fromRaw(netRaw) / fromRaw(sharesOutRaw),
    priceBefore: pricesBefore[outcomeIdx],
    priceAfter: pricesAfter[outcomeIdx],
    priceImpactPts: (pricesAfter[outcomeIdx] - pricesBefore[outcomeIdx]) * 100,
    pricesBefore,
    pricesAfter,
    reservesAfter: newReservesRaw.map(fromRaw),
    reservesAfterRaw: newReservesRaw,
  };
}

/**
 * Quote a sell of `shares` tokens of outcome `outcomeIdx` back to an
 * N-outcome pool. Solved via Newton's method on the sell polynomial.
 *
 * Math:
 *   User deposits α tokens of outcome i, pool returns C collateral by
 *   burning C of each reserve. Invariant preserved:
 *     (r_i + α − C) · ∏_{j≠i}(r_j − C) = ∏_j r_j = K
 *   That's a degree-N polynomial in C with no general closed form for
 *   N ≥ 3. We solve numerically:
 *     f(C)  = product with (r_i+α−C), (r_j−C) − K
 *     f'(C) = -Σ_k ∏_{j≠k}(term_j)
 *   Start from C₀ = α · p_i (a lower bound; ignores impact). Newton:
 *     C_{n+1} = C_n − f(C_n) / f'(C_n)
 *   Converges to ≤1 raw (1 microMXNP) in ~4–8 iterations for realistic
 *   pools. Bounded above by min(r_j for j≠i) − 1 to keep reserves > 0.
 *
 * Zero sell fee (same as binary) — user receives full C.
 */
export function multiSellQuote(reservesHuman, outcomeIdx, sharesHuman) {
  if (!Array.isArray(reservesHuman) || reservesHuman.length < 2) {
    throw new Error('amm-math: multi-outcome needs ≥ 2 reserves');
  }
  if (outcomeIdx < 0 || outcomeIdx >= reservesHuman.length) {
    throw new Error('amm-math: outcome_index out of range');
  }
  if (sharesHuman <= 0) throw new Error('amm-math: shares must be > 0');

  const reserves = reservesHuman.map(toRaw);
  const n = reserves.length;
  if (reserves.some(r => r <= 0n)) {
    throw new Error('amm-math: empty reserves');
  }

  const sharesRaw = toRaw(sharesHuman);

  // K_pre = ∏ r_j.
  let K = 1n;
  for (const r of reserves) K = K * r;

  // Hard ceiling for C: slightly below the smallest non-sold reserve.
  // At C = min_other, one of the (r_j − C) terms hits zero, f(C) = −K.
  // We need to stay strictly below that to avoid a negative factor.
  //
  // Initialize minOther to a concrete BigInt right away (the first
  // non-idx reserve) rather than starting with `null`. Keeping the
  // type strictly BigInt avoids the BigInt|null union that static
  // analyzers have trouble with around `minOther - 1n`.
  let minOther = reserves[outcomeIdx === 0 ? 1 : 0];
  for (let j = 0; j < n; j++) {
    if (j === outcomeIdx) continue;
    if (reserves[j] < minOther) minOther = reserves[j];
  }
  const cMax = minOther - 1n;
  if (cMax <= 0n) {
    throw new Error('amm-math: sell would drain pool');
  }

  // Initial guess: α × current price of outcome i. Inputs are validated
  // (all reserves > 0n), so multiPriceRaw always returns a BigInt here
  // — no `|| fallback` needed, keeping pInit strictly typed.
  const pInit = multiPriceRaw(reserves, outcomeIdx);
  let C = (sharesRaw * pInit) / PRICE_SCALE;
  if (C <= 0n) C = 1n;
  if (C >= cMax) C = cMax / 2n;

  const MAX_ITER = 32;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Build the N term array: term_j = r_j − C  (j ≠ i),  term_i = r_i + α − C.
    const terms = new Array(n);
    for (let j = 0; j < n; j++) {
      terms[j] = j === outcomeIdx ? (reserves[j] + sharesRaw - C) : (reserves[j] - C);
      if (terms[j] <= 0n) {
        // Newton stepped past the bound — back off halfway toward cMax/2.
        C = C / 2n;
        continue;
      }
    }
    // Re-check after the possible back-off.
    let anyNonPositive = false;
    for (let j = 0; j < n; j++) {
      const t = j === outcomeIdx ? (reserves[j] + sharesRaw - C) : (reserves[j] - C);
      if (t <= 0n) { anyNonPositive = true; break; }
      terms[j] = t;
    }
    if (anyNonPositive) continue;

    // f(C) = ∏ terms − K. Positive when C is below the root.
    let prod = 1n;
    for (const t of terms) prod = prod * t;
    const fC = prod - K;

    // Already converged to an exact integer root.
    if (fC === 0n) return finalize(reserves, outcomeIdx, sharesRaw, C, n);

    // f'(C) = −Σ_k ∏_{j≠k} terms[j]. Use the factor trick again:
    //   ∏_{j≠k} terms = prod / terms[k]
    let fPrime = 0n;
    for (let k = 0; k < n; k++) {
      fPrime = fPrime - (prod / terms[k]);
    }
    if (fPrime === 0n) break; // pathological; break out and use current C

    // Newton step. fC > 0 ⇒ delta < 0 ⇒ move C right.
    const delta = fC / fPrime; // BigInt truncates toward zero
    let Cnext = C - delta;

    // Clamp within (0, cMax).
    if (Cnext <= 0n) Cnext = 1n;
    if (Cnext >= cMax) Cnext = (C + cMax) / 2n;

    const stepSize = absDiff(Cnext, C);
    C = Cnext;
    if (stepSize <= 1n) break; // converged to sub-microMXNP precision
  }

  return finalize(reserves, outcomeIdx, sharesRaw, C, n);
}

// Shared tail of multiSellQuote — computes the full return shape once
// Newton has landed on a C value.
function finalize(reservesRaw, outcomeIdx, sharesRaw, C, n) {
  const newReservesRaw = reservesRaw.map((r, j) =>
    j === outcomeIdx ? (r + sharesRaw - C) : (r - C),
  );

  if (newReservesRaw.some(r => r <= 0n)) {
    throw new Error('amm-math: sell would drain pool');
  }

  // Both vectors are strictly positive BigInt[] here, so multiPriceRaw
  // is safe without a null fallback. Explicit loop keeps every slot
  // typed BigInt-then-Number with no BigInt|null union step.
  const pricesBefore = new Array(n);
  const pricesAfter = new Array(n);
  for (let i = 0; i < n; i++) {
    pricesBefore[i] = rawToProbability(multiPriceRaw(reservesRaw, i));
    pricesAfter[i] = rawToProbability(multiPriceRaw(newReservesRaw, i));
  }

  return {
    shares: fromRaw(sharesRaw),
    gross: fromRaw(C),
    fee: 0,
    feePct: 0,
    collateralOut: fromRaw(C),
    priceBefore: pricesBefore[outcomeIdx],
    priceAfter: pricesAfter[outcomeIdx],
    priceImpactPts: (pricesAfter[outcomeIdx] - pricesBefore[outcomeIdx]) * 100,
    pricesBefore,
    pricesAfter,
    reservesAfter: newReservesRaw.map(fromRaw),
    reservesAfterRaw: newReservesRaw,
  };
}

// Exported for tests
export const _internal = {
  SCALE,
  PRICE_SCALE,
  sqrtBig,
  ceilDiv,
};
