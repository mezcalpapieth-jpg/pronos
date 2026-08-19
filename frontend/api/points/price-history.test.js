import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./price-history.js', import.meta.url), 'utf8');

test('points price history supports short hour windows for detail charts', () => {
  assert.match(source, /GET \/api\/points\/price-history\?ids=1,2,3&hours=4/);
  assert.match(source, /const hoursRaw = parseInt\(req\.query\.hours, 10\)/);
  assert.match(source, /const windowHours = Number\.isInteger\(hoursRaw\)/);
  assert.match(source, /\|\| ' hours'/);
});

test('points price history includes binary orderbook fills that do not move reserves', () => {
  assert.match(source, /PRONOS_TREASURY_USERNAME/);
  assert.match(source, /displayTradePointsFromRows/);
  assert.match(source, /mergeDisplayPricePoints/);
  assert.match(source, /const displayTradeRows = outcomeIdx <= 1 \? await sql/);
  assert.match(source, /t\.side IN \('buy', 'sell'\)/);
  assert.match(source, /jsonb_array_length\(m\.outcomes\) = 2/);
  assert.match(source, /tradeRowCap/);
  assert.match(source, /priceHistoryExecutionBucket\(r\.snapshotted_at\)/);
  assert.match(source, /sort\(\(a, b\) => a\.t - b\.t \|\| a\._id - b\._id\)/);
});
