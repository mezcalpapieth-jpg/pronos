import { sortMarketsByLiveThenEndDate } from './marketOrdering.js';

export const POINTS_MARKET_SORTS = ['trending', 'volume', 'new', 'closing'];

function timestamp(value) {
  const date = value == null || value === '' ? NaN : new Date(value).getTime();
  return Number.isFinite(date) ? date : -Infinity;
}

function turnover(value) {
  const volume = value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(volume) && volume >= 0 ? volume : -Infinity;
}

// The grid supplies its existing Trending order, which also breaks ties.
export function orderPointsMarkets(markets, sort, now = Date.now()) {
  if (sort === 'closing') return sortMarketsByLiveThenEndDate(markets, now);
  if (sort === 'volume') return [...markets].sort((a, b) => turnover(b.tradeVolume) - turnover(a.tradeVolume));
  if (sort === 'new') return [...markets].sort((a, b) => timestamp(b.createdAt) - timestamp(a.createdAt));
  return markets;
}
