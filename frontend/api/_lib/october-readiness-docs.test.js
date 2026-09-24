import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runbook = await readFile(new URL('../../../docs/OCTOBER_TOURNAMENT_READINESS.md', import.meta.url), 'utf8');
const vercelConfig = await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8');

test('October tournament readiness runbook covers admin checks and production cron probes', () => {
  assert.match(runbook, /October Tournament Readiness/);
  assert.match(runbook, /Launch tab/);
  assert.match(runbook, /october-tournament-2026/);
  assert.match(runbook, /CRON_SECRET/);
  assert.match(runbook, /points-auto-resolve\?dry=1/);
  assert.match(runbook, /points-maker-rewards\?dry=1/);
  assert.match(runbook, /points-snapshot-prices\?dry=1/);
  assert.match(runbook, /points-tournament-snapshot/);
  assert.match(runbook, /Evidence Log/);
});

test('Vercel config keeps October tournament production crons declared', () => {
  assert.match(vercelConfig, /"path": "\/api\/cron\/generate-markets-pending"[\s\S]*"schedule": "0 15 \* \* \*"/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/points-auto-resolve"[\s\S]*"schedule": "\*\/15 \* \* \* \*"/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/points-parlay-settle"[\s\S]*"schedule": "\*\/15 \* \* \* \*"/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/points-maker-rewards"[\s\S]*"schedule": "0 16 \* \* \*"/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/points-snapshot-prices"[\s\S]*"schedule": "0 \* \* \* \*"/);
  assert.match(vercelConfig, /"path": "\/api\/cron\/points-tournament-snapshot"[\s\S]*"schedule": "59 5 \* \* \*"/);
});
