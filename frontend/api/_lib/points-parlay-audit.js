import { parlayLegResult, parlayResult } from './points-parlay-outcomes.js';

const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const round2 = value => Math.round(number(value) * 100) / 100;
const round6 = value => Math.round(number(value) * 1000000) / 1000000;
const differs = (a, b) => Math.abs(number(a) - number(b)) > 0.000001;

export function serializeParlayAudit(row) {
  const legs = Array.isArray(row.legs) ? row.legs : [];
  const resultStatus = parlayResult(legs.map(leg => parlayLegResult(leg).status));
  const stake = number(row.stake);
  const payout = number(row.payout);
  const creditedPayout = number(row.paid_amount);
  const status = row.status;
  const expectedPayout = resultStatus === 'won' ? number(row.potential_payout)
    : resultStatus === 'void' ? stake : 0;
  const settlementPending = status === 'open' && resultStatus !== 'open';
  const issues = [];
  if (number(row.entry_count) !== 1 || differs(row.entry_amount, -stake)) issues.push('entry_mismatch');
  if (number(row.wrong_user_count) > 0) issues.push('ledger_owner_mismatch');
  if (number(row.payment_count) > 1) issues.push('duplicate_payment');
  if (status !== 'open' && status !== resultStatus) issues.push('result_mismatch');
  if (status !== 'open' && (differs(payout, expectedPayout) || differs(creditedPayout, payout)
    || number(row.payment_count) !== (payout > 0 ? 1 : 0)
    || number(row.wrong_payment_kind_count) > 0)) issues.push('payment_mismatch');
  if (status === 'open' && (payout !== 0 || creditedPayout !== 0 || number(row.payment_count) > 0)) {
    issues.push('payment_before_settlement');
  }

  return {
    id: Number(row.id), username: row.username,
    cycleId: row.cycle_id == null ? null : Number(row.cycle_id),
    stake: round6(stake), multiplier: round2(row.multiplier),
    potentialPayout: round6(row.potential_payout),
    potentialPnl: round6(number(row.potential_payout) - stake),
    payout: round6(payout), creditedPayout: round6(creditedPayout),
    expectedPayout: round6(expectedPayout), status,
    derivedStatus: resultStatus, resultStatus, settlementPending,
    realizedPnl: status === 'open' ? null : round6(creditedPayout - stake),
    auditIssues: issues,
    submittedAt: row.submitted_at, settledAt: row.settled_at, reason: row.reason || null,
    legs: legs.map(leg => ({
      ...leg, id: Number(leg.id), marketId: Number(leg.marketId),
      outcomeIndex: Number(leg.outcomeIndex), price: round2(leg.price),
      storedStatus: leg.storedStatus || 'open', derivedStatus: parlayLegResult(leg).status,
      resolvedOutcome: leg.resolvedOutcome == null ? null : Number(leg.resolvedOutcome),
      marketOutcome: leg.marketOutcome == null ? null : Number(leg.marketOutcome),
    })),
  };
}

export function summarizeParlayAudit(tickets) {
  const summary = tickets.reduce((summary, ticket) => {
    summary.count += 1;
    summary.stake += ticket.stake;
    summary.potentialPayout += ticket.potentialPayout;
    summary.creditedPayout += ticket.creditedPayout;
    summary.realizedPnl += ticket.realizedPnl ?? 0;
    summary[ticket.status] = number(summary[ticket.status]) + 1;
    if (ticket.settlementPending) {
      summary.awaitingSettlement += 1;
      summary.awaitingPayout += ticket.expectedPayout;
    }
    if (ticket.auditIssues.length > 0) summary.auditIssues += 1;
    return summary;
  }, { count: 0, stake: 0, potentialPayout: 0, creditedPayout: 0, realizedPnl: 0,
    open: 0, won: 0, lost: 0, void: 0, awaitingSettlement: 0, awaitingPayout: 0, auditIssues: 0 });
  for (const key of ['stake', 'potentialPayout', 'creditedPayout', 'realizedPnl', 'awaitingPayout']) {
    summary[key] = round2(summary[key]);
  }
  return summary;
}
