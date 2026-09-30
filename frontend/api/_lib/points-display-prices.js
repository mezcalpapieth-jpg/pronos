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
