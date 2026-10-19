// Use the same accent-insensitive matching in every public market search.
export function normalizeSearchText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function matchesMarketSearch(market, query) {
  return normalizeSearchText(market?.question).includes(normalizeSearchText(query));
}
