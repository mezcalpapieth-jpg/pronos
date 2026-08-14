import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const envExample = await readFile(new URL('../../../.env.example', import.meta.url), 'utf8');
const runbook = await readFile(new URL('../../../docs/MVP_MAINNET_READINESS.md', import.meta.url), 'utf8');

test('env example documents Juno funding and owner lifecycle controls', () => {
  assert.match(envExample, /JUNO_API_KEY=/);
  assert.match(envExample, /JUNO_API_SECRET=/);
  assert.match(envExample, /JUNO_BEARER_TOKEN=/);
  assert.match(envExample, /JUNO_API_BASE_URL=/);
  assert.match(envExample, /JUNO_WEBHOOK_SECRET=/);
  assert.match(envExample, /JUNO_CARD_CHECKOUT_ENABLED=/);
  assert.match(envExample, /JUNO_APPLE_PAY_ENABLED=/);
  assert.match(envExample, /JUNO_WITHDRAWALS_ENABLED=/);
  assert.match(envExample, /ONCHAIN_OWNER_SUBORG_ID=/);
  assert.match(envExample, /ONCHAIN_OWNER_ADDRESS=/);
  assert.match(envExample, /GAS_SPONSORSHIP_ENABLED=/);
});

test('mainnet readiness runbook covers provider, deployment, canary, and emergency rehearsals', () => {
  assert.match(runbook, /Juno \/ Bitso/i);
  assert.match(runbook, /Turnkey/i);
  assert.match(runbook, /Safe/i);
  assert.match(runbook, /INDEXER_START_BLOCK/);
  assert.match(runbook, /CRE_RESOLUTION_WEBHOOK_SECRET/);
  assert.match(runbook, /canary market/i);
  assert.match(runbook, /push-cancel-refunds/);
  assert.match(runbook, /Gas sponsorship/i);
});
