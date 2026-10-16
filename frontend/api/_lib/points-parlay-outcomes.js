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

// Result and collection are separate: an open cash ticket can already have won.
export function parlayTicketResult(ticket, legs) {
  const storedStatus = String(ticket.status || 'open').toLowerCase();
  const status = storedStatus === 'open'
    ? parlayResult(legs.map(leg => parlayLegResult(leg).status))
    : storedStatus;
  const stake = Number(ticket.stake || 0);
  const payout = status === 'won'
    ? Number(storedStatus === 'won' ? ticket.payout || ticket.potential_payout || 0 : ticket.potential_payout || 0)
    : status === 'void' ? stake : 0;
  return {
    status,
    payout,
    pnl: status === 'won' ? payout - stake : status === 'lost' ? -stake : 0,
    claimable: storedStatus === 'open' && payout > 0 && ['won', 'void'].includes(status),
  };
}
