import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeParlayAudit, summarizeParlayAudit } from './points-parlay-audit.js';
import { parlayLegResult, parlayResult } from './points-parlay-outcomes.js';

const wonLeg = { marketStatus: 'resolved', marketOutcome: 1, outcomeIndex: 1 };
function ticket(overrides = {}) {
  return { id: 86, username: 'rene', stake: '100.000000', potential_payout: '2500.000000',
    payout: '0.000000', status: 'open', entry_count: '1', entry_amount: '-100.000000',
    payment_count: '0', paid_amount: '0.000000', legs: [wonLeg, wonLeg, wonLeg], ...overrides };
}

test('a winning result with numeric-string zero payout remains unpaid, not a realized loss', () => {
  const row = serializeParlayAudit(ticket());
  assert.equal(row.status, 'open');
  assert.equal(row.resultStatus, 'won');
  assert.equal(row.settlementPending, true);
  assert.equal(row.expectedPayout, 2500);
  assert.equal(row.creditedPayout, 0);
  assert.equal(row.realizedPnl, null);
  assert.deepEqual(row.auditIssues, []);
});

test('a paid win reports only the ledger credit minus stake', () => {
  const row = serializeParlayAudit(ticket({ status: 'won', payout: '2500.000000', paid_amount: '2500.000000', payment_count: '1' }));
  assert.equal(row.realizedPnl, 2400);
  assert.equal(row.settlementPending, false);
  assert.deepEqual(row.auditIssues, []);
});

test('a loss has no credit, a refund breaks even, and pending losses have no realized PnL', () => {
  const legs = [{ ...wonLeg, outcomeIndex: 0 }];
  assert.equal(serializeParlayAudit(ticket({ status: 'lost', legs })).realizedPnl, -100);
  assert.equal(serializeParlayAudit(ticket({ legs })).realizedPnl, null);
  const refund = serializeParlayAudit(ticket({ status: 'void', payout: '100', paid_amount: '100', payment_count: 1,
    legs: [{ marketStatus: 'canceled' }] }));
  assert.equal(refund.realizedPnl, 0);
  assert.deepEqual(refund.auditIssues, []);
});

test('settlement and audit share invalid-outcome, cancellation and loss precedence rules', () => {
  for (const outcome of [null, -1, 'not-an-index']) {
    assert.equal(parlayLegResult({ marketStatus: 'resolved', marketOutcome: outcome }).status, 'void');
  }
  assert.equal(parlayResult(['void', 'lost', 'open']), 'lost');
  assert.equal(parlayResult(['won', 'void', 'open']), 'void');
  assert.equal(parlayResult([]), 'open');
  assert.equal(parlayResult(['won', 'open']), 'open');
  assert.equal(parlayLegResult({ market_status: 'resolved', market_outcome: 0, outcome_index: 0 }).status, 'won');
});

test('audit flags missing or duplicate credits, changed outcomes and wrong owners', () => {
  assert.ok(serializeParlayAudit(ticket({ status: 'won', payout: '2500' })).auditIssues.includes('payment_mismatch'));
  assert.ok(serializeParlayAudit(ticket({ status: 'won', payout: '2500', paid_amount: '5000', payment_count: 2 })).auditIssues.includes('duplicate_payment'));
  assert.ok(serializeParlayAudit(ticket({ status: 'won', legs: [{ ...wonLeg, outcomeIndex: 0 }] })).auditIssues.includes('result_mismatch'));
  assert.ok(serializeParlayAudit(ticket({ wrong_user_count: 1 })).auditIssues.includes('ledger_owner_mismatch'));
  assert.ok(serializeParlayAudit(ticket({ entry_count: 2 })).auditIssues.includes('entry_mismatch'));
  assert.ok(serializeParlayAudit(ticket({ paid_amount: 2500, payment_count: 1 })).auditIssues.includes('payment_before_settlement'));
});

test('summary distinguishes pending money from paid results across the complete input', () => {
  const rows = [serializeParlayAudit(ticket()), serializeParlayAudit(ticket({ status: 'won', payout: '2500', paid_amount: '2500', payment_count: 1 }))];
  const summary = summarizeParlayAudit(rows);
  assert.equal(summary.count, 2);
  assert.equal(summary.open, 1);
  assert.equal(summary.won, 1);
  assert.equal(summary.awaitingSettlement, 1);
  assert.equal(summary.awaitingPayout, 2500);
  assert.equal(summary.creditedPayout, 2500);
  assert.equal(summary.realizedPnl, 2400);
});

test('cycle totals round once after adding exact six-decimal credits', () => {
  const rows = [1, 2, 3].map(id => serializeParlayAudit(ticket({ id, status: 'won',
    potential_payout: '100.004000', payout: '100.004000', paid_amount: '100.004000', payment_count: 1 })));
  assert.equal(rows[0].creditedPayout, 100.004);
  assert.equal(summarizeParlayAudit(rows).creditedPayout, 300.01);
  assert.equal(summarizeParlayAudit(rows).realizedPnl, 0.01);
});
