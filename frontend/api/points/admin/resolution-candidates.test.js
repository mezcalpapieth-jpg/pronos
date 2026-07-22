import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('points resolution candidate endpoint counts queued and overdue markets', async () => {
  const source = await readFile(new URL('./resolution-candidates.js', import.meta.url), 'utf8');

  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /req\.method === 'GET'/);
  assert.match(source, /pendingCount/);
  assert.match(source, /overdueCount/);
  assert.match(source, /JOIN points_markets/);
  assert.match(source, /m\.status = 'active'/);
  assert.match(source, /COUNT\(DISTINCT market_id\)::int AS count/);
  assert.match(source, /end_time < NOW\(\)/);
});

test('points resolution candidate endpoint confirms or denies review suggestions', async () => {
  const source = await readFile(new URL('./resolution-candidates.js', import.meta.url), 'utf8');

  assert.match(source, /action === 'confirm'/);
  assert.match(source, /action === 'deny'/);
  assert.match(source, /status = 'confirmed'/);
  assert.match(source, /status = 'denied'/);
  assert.match(source, /final_score = COALESCE/);
  assert.match(source, /bestEffortPersistResolvedCryptoMarketSnapshot/);
  assert.match(source, /parent_id = \$1/);
  assert.match(source, /legWinningOutcome = i === outcome \? 0 : 1/);
});
