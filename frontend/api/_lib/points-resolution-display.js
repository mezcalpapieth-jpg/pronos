// Display settlement independently of the AMM's last trading reserves.
// Each parallel leg is a binary market with its own winning outcome.
export function resolvedMarketPrices({ status, outcome, outcomes } = {}) {
  if (status !== 'resolved' || outcome == null || outcome === '') return null;
  const winner = Number(outcome);
  if (!Array.isArray(outcomes) || !Number.isInteger(winner) || winner < 0 || winner >= outcomes.length) return null;
  return outcomes.map((_, index) => index === winner ? 1 : 0);
}

export function appendResolutionPoint(series, window, outcomeIndex) {
  const prices = resolvedMarketPrices(window);
  const price = prices?.[outcomeIndex];
  if (price == null) return series;
  const t = new Date(window.dataEnd).getTime() / 1000;
  const start = new Date(window.start).getTime() / 1000;
  const end = new Date(window.end).getTime() / 1000;
  if (!Number.isFinite(t) || t > end) return series;
  // An early-resolved leg stays at its settlement value throughout any
  // later parent window, even if its own history predates that window.
  const settledAt = Math.max(start, t);
  return [...series.filter(point => point.t < settledAt), { t: settledAt, p: price * 100 }];
}
