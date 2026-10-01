function timeMs(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

function marketDateRank(market, nowMs) {
  const status = String(market?.status || 'active').toLowerCase();
  const endMs = timeMs(market?.endTime);
  if (Number.isFinite(endMs) && endMs > nowMs) return 1;
  if (Number.isFinite(endMs)) return 2;
  if (status === 'resolved') return 2;
  return 3;
}

export function sortMarketsByLiveThenEndDate(markets = [], nowMs = Date.now()) {
  return markets
    .map((market, index) => ({
      market,
      index,
      rank: marketDateRank(market, nowMs),
      endMs: timeMs(market?.endTime),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.rank === 2 && a.endMs !== b.endMs) return b.endMs - a.endMs;
      if (a.endMs !== b.endMs) return a.endMs - b.endMs;
      return a.index - b.index;
    })
    .map(item => item.market);
}
