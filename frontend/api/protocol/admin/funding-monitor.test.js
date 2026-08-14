import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./funding-monitor.js', import.meta.url), 'utf8').catch(() => '');
const schemaSource = await readFile(new URL('../../_lib/juno-funding.js', import.meta.url), 'utf8');
const withdrawalSource = await readFile(new URL('../onboarding/withdrawal-request.js', import.meta.url), 'utf8').catch(() => '');

test('funding schema stores withdrawal requests and transaction events', () => {
  assert.match(schemaSource, /CREATE TABLE IF NOT EXISTS juno_withdrawal_requests/);
  assert.match(schemaSource, /destination_clabe/);
  assert.match(schemaSource, /status\s+TEXT NOT NULL DEFAULT 'pending'/);
  assert.match(schemaSource, /juno_transaction_events/);
});

test('withdrawal request endpoint creates shell requests without forcing provider movement', () => {
  assert.match(withdrawalSource, /POST \/api\/protocol\/onboarding\/withdrawal-request/);
  assert.match(withdrawalSource, /requireSession/);
  assert.match(withdrawalSource, /juno_withdrawal_requests/);
  assert.match(withdrawalSource, /JUNO_WITHDRAWALS_ENABLED/);
  assert.match(withdrawalSource, /requestJunoWithdrawal/);
});

test('admin funding monitor summarizes missing CLABE, stuck deposits, and pending withdrawals', () => {
  assert.match(source, /GET \/api\/protocol\/admin\/funding-monitor/);
  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /buildAdminFundingMonitorPayload/);
  assert.match(source, /juno_funding_accounts/);
  assert.match(source, /juno_withdrawal_requests/);
  assert.match(source, /juno_transaction_events/);
});
