export function parlayLegResult(leg) {
  const marketStatus = String(leg.market_status ?? leg.marketStatus ?? '').toLowerCase();
  const rawOutcome = leg.market_outcome ?? leg.marketOutcome;
  const resolvedOutcome = rawOutcome == null ? null : Number(rawOutcome);
  if (marketStatus === 'canceled' || marketStatus === 'cancelled') {
    return { status: 'void', resolvedOutcome: null };
  }
  if (marketStatus !== 'resolved') return { status: 'open', resolvedOutcome: null };
  if (!Number.isInteger(resolvedOutcome) || resolvedOutcome < 0) {
    return { status: 'void', resolvedOutcome: null };
  }
  return {
    status: resolvedOutcome === Number(leg.outcome_index ?? leg.outcomeIndex) ? 'won' : 'lost',
    resolvedOutcome,
  };
}

export function parlayResult(statuses) {
  if (statuses.includes('lost')) return 'lost';
  if (statuses.includes('void')) return 'void';
  if (statuses.length > 0 && statuses.every(status => status === 'won')) return 'won';
  return 'open';
}
