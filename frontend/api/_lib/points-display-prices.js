function cleanProbability(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

function isBookOnlyTrade(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

export function binaryPricesWithBookTrade(basePrices, {
  status,
  outcomeIndex,
  price,
  isBookTrade,
} = {}) {
  if (String(status || '').toLowerCase() !== 'active') return basePrices;
  if (!isBookOnlyTrade(isBookTrade)) return basePrices;
  if (!Array.isArray(basePrices) || basePrices.length !== 2) return basePrices;

  const oi = Number(outcomeIndex);
  const p = cleanProbability(price);
  if (!Number.isInteger(oi) || oi < 0 || oi > 1 || p === null) return basePrices;

  return oi === 0 ? [p, 1 - p] : [1 - p, p];
}

export function pricesWithBookTrades(basePrices, {
  status,
  trades,
} = {}) {
  if (String(status || '').toLowerCase() !== 'active') return basePrices;
  if (!Array.isArray(basePrices) || basePrices.length < 2) return basePrices;
  const n = basePrices.length;
  if (n === 2) {
    const trade = (Array.isArray(trades) ? trades : [])
      .filter(row => isBookOnlyTrade(row?.isBookTrade))
      .sort((a, b) => Number(b?.lastAtMs || 0) - Number(a?.lastAtMs || 0))[0];
    return binaryPricesWithBookTrade(basePrices, {
      status,
      outcomeIndex: trade?.outcomeIndex,
      price: trade?.price,
      isBookTrade: trade?.isBookTrade,
    });
  }

  const cleanedBase = basePrices.map(cleanProbability);
  if (cleanedBase.some(value => value === null)) return basePrices;

  const explicit = new Map();
  for (const row of Array.isArray(trades) ? trades : []) {
    if (!isBookOnlyTrade(row?.isBookTrade)) continue;
    const oi = Number(row?.outcomeIndex);
    const p = cleanProbability(row?.price);
    if (!Number.isInteger(oi) || oi < 0 || oi >= n || p === null) continue;
    explicit.set(oi, p);
  }
  if (explicit.size === 0) return basePrices;

  const next = [...cleanedBase];
  let explicitSum = 0;
  for (const [, value] of explicit) explicitSum += value;

  // Independent book fills can momentarily imply an overround. Keep the
  // display vector valid by reserving a small visible remainder for any
  // outcomes that did not trade in the latest burst, then scale them by
  // their AMM weights.
  const missing = n - explicit.size;
  const maxExplicitSum = missing > 0 ? Math.max(0.01, 1 - missing * 0.01) : 1;
  const explicitScale = explicitSum > maxExplicitSum && explicitSum > 0
    ? maxExplicitSum / explicitSum
    : 1;

  explicitSum = 0;
  for (const [oi, value] of explicit) {
    next[oi] = value * explicitScale;
    explicitSum += next[oi];
  }

  const remainder = Math.max(0, 1 - explicitSum);
  const missingIndexes = next
    .map((_, index) => index)
    .filter(index => !explicit.has(index));
  if (missingIndexes.length > 0) {
    const baseRemainder = missingIndexes.reduce((sum, index) => sum + cleanedBase[index], 0);
    for (const index of missingIndexes) {
      next[index] = baseRemainder > 0
        ? (cleanedBase[index] / baseRemainder) * remainder
        : remainder / missingIndexes.length;
    }
  } else {
    const total = next.reduce((sum, value) => sum + value, 0);
    if (total > 0) return next.map(value => value / total);
  }

  return next;
}

function cleanCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : [candidates])
    .map(cleanProbability)
    .filter(value => value !== null);
}

export function monotonicBuyDisplayPrice(priceBefore, candidates = []) {
  const before = cleanProbability(priceBefore) ?? 0;
  const values = cleanCandidates(candidates);
  return Math.max(before, ...values);
}

export function monotonicSellDisplayPrice(priceBefore, candidates = []) {
  const before = cleanProbability(priceBefore) ?? 0;
  const values = cleanCandidates(candidates);
  return values.length > 0 ? Math.min(before, ...values) : before;
}
