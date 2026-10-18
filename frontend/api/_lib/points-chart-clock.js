function timestamp(value) {
  if (value == null || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Browser-safe: the UI and history APIs must agree on when the clock stops.
export function marketChartClock(market, now = Date.now()) {
  const current = new Date(now).getTime();
  const terminal = ['resolved', 'canceled'].includes(market?.status);
  const end = timestamp(market?.endTime ?? market?.end_time);
  const resolved = terminal ? timestamp(market?.resolvedAt ?? market?.resolved_at) : null;
  // Settlement can arrive after trading closes. Include that final result
  // instead of freezing the chart at the last tradable probability.
  if (market?.status === 'resolved' && resolved != null && resolved <= current) {
    return { endMs: resolved, frozen: true };
  }
  const cutoffs = [end, resolved].filter(value => value != null && value <= current);
  if (terminal && !cutoffs.length) {
    const fallback = timestamp(market?.lastTradeAt) ?? timestamp(market?.createdAt ?? market?.created_at);
    if (fallback != null && fallback <= current) cutoffs.push(fallback);
  }
  return { endMs: cutoffs.length ? Math.min(...cutoffs) : current, frozen: terminal || cutoffs.length > 0 };
}
