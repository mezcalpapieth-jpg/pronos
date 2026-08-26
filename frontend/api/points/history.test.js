import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./history.js', import.meta.url), 'utf8');

test('winning unresolved history includes claimable payout in displayed PnL', () => {
  assert.match(source, /claimablePayout/);
  assert.match(source, /redeemedWinning = Number\.isInteger\(winningOutcomeIndex\)/);
  assert.match(source, /m\.redeemedByOutcome\.get\(winningOutcomeIndex\)/);
  assert.match(source, /effectiveReceived = m\.totalReceived \+ claimablePayout/);
  assert.match(source, /settledNetPnl = round2\(effectiveReceived - m\.totalInvested\)/);
});

test('history still exposes realized received separately from claimable payout', () => {
  assert.match(source, /realizedReceived: round2\(m\.totalReceived\)/);
  assert.match(source, /totalReceived: round2\(effectiveReceived\)/);
});

test('open-market history PnL includes mark-to-market like the chart', () => {
  assert.match(source, /import \{ binaryPrices, multiPrices \} from '\.\.\/_lib\/amm-math\.js'/);
  assert.match(source, /markToMarket: round2\(mtm\)/);
  assert.match(source, /netPnl = round2\(effectiveReceived \+ mtm - m\.totalInvested\)/);
  assert.match(source, /multiPrices\(reserves\)/);
});

test('portfolio history exposes the bought outcome at market level', () => {
  assert.match(source, /function displayOutcomeLabel\(m, i\)/);
  assert.match(source, /m\?\.parentMarketId/);
  assert.match(source, /m\.legLabel \|\| 'Opción'/);
  assert.match(source, /function pickedOutcomeSummary\(transactions = \[\]\)/);
  assert.match(source, /tx\?\.side !== 'buy'/);
  assert.match(source, /pickedOutcomeLabels: labels/);
  assert.match(source, /pickedOutcomeLabel: labels\.join\(', '\)/);
  assert.match(source, /\.\.\.pickedOutcome/);
});

test('portfolio history defaults to the current cycle window', () => {
  assert.match(source, /function parseCycleScope\(value\)/);
  assert.match(source, /String\(value \|\| 'current'\)\.toLowerCase\(\)/);
  assert.match(source, /resolveCycleWindow\(cycleScope\)/);
  assert.match(source, /WHERE status = 'active'/);
  assert.match(source, /WHERE status = 'closed'/);
  assert.match(source, /t\.created_at >= \$\{cycleWindow\.fromIso\}::timestamptz/);
  assert.match(source, /t\.created_at < \$\{cycleWindow\.toIso\}::timestamptz/);
  assert.match(source, /d\.created_at >= \$\{cycleWindow\.fromIso\}::timestamptz/);
});

test('previous-cycle unresolved markets are not labeled open', () => {
  assert.match(source, /outcomeStatus = 'cycle_closed'/);
  assert.match(source, /marketsCycleClosed: history\.filter\(m => m\.outcomeStatus === 'cycle_closed'\)\.length/);
});

test('portfolio history includes resolution correction reversals', () => {
  assert.match(source, /redemption_reversal/);
  assert.match(source, /Corrección de resolución/);
  assert.match(source, /bucket\.totalReceived \+= collateral/);
});
