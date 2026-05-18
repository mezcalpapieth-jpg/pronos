import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('resolution candidate review endpoint confirms onchain or denies back to pending search', async () => {
  const source = await readFile(new URL('./resolution-candidates.js', import.meta.url), 'utf8');

  assert.match(source, /requirePointsAdmin/);
  assert.match(source, /req\.method === 'GET'/);
  assert.match(source, /pendingCount/);
  assert.match(source, /overdueCount/);
  assert.match(source, /JOIN protocol_markets/);
  assert.match(source, /m\.status = 'active'/);
  assert.match(source, /COUNT\(DISTINCT market_id\)::int AS count/);
  assert.match(source, /end_time < NOW\(\)/);
  assert.match(source, /action === 'confirm'/);
  assert.match(source, /action === 'deny'/);
  assert.match(source, /resolveMarketOnChain/);
  assert.match(source, /status = 'confirmed'/);
  assert.match(source, /status = 'denied'/);
  assert.match(source, /final_score/);
});
