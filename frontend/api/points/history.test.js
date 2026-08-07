import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./history.js', import.meta.url), 'utf8');

test('winning unresolved history includes claimable payout in displayed PnL', () => {
  assert.match(source, /claimablePayout/);
  assert.match(source, /redeemedByOutcome\.get\(winningIdx\)/);
  assert.match(source, /effectiveReceived = m\.totalReceived \+ claimablePayout/);
  assert.match(source, /netPnl = round2\(effectiveReceived - m\.totalInvested\)/);
});

test('history still exposes realized received separately from claimable payout', () => {
  assert.match(source, /realizedReceived: round2\(m\.totalReceived\)/);
  assert.match(source, /totalReceived: round2\(effectiveReceived\)/);
});

test('portfolio history exposes the bought outcome at market level', () => {
  assert.match(source, /function pickedOutcomeSummary\(transactions = \[\]\)/);
  assert.match(source, /tx\?\.side !== 'buy'/);
  assert.match(source, /pickedOutcomeLabels: labels/);
  assert.match(source, /pickedOutcomeLabel: labels\.join\(', '\)/);
  assert.match(source, /\.\.\.pickedOutcome/);
});
