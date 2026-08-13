export function binaryPricesWithBookTrade(basePrices, {
  status,
  outcomeIndex,
  price,
  isBookTrade,
} = {}) {
  if (String(status || '').toLowerCase() !== 'active') return basePrices;
  const bookTrade = isBookTrade === true || String(isBookTrade).toLowerCase() === 'true';
  if (!bookTrade) return basePrices;
  if (!Array.isArray(basePrices) || basePrices.length !== 2) return basePrices;

  const oi = Number(outcomeIndex);
  const p = Number(price);
  if (!Number.isInteger(oi) || oi < 0 || oi > 1) return basePrices;
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return basePrices;

  return oi === 0 ? [p, 1 - p] : [1 - p, p];
}
