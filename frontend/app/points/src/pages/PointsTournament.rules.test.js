import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsTournament.jsx', import.meta.url), 'utf8');

test('tournament rules explain lot-based holding, combo slips, and liquidity rewards', () => {
  assert.match(source, /Each buy lot has its own clock/);
  assert.match(source, /Cada compra tiene su propio reloj/);
  assert.match(source, /Create them from the \+ Combo buttons/);
  assert.match(source, /Se arman desde los botones \+ Combo/);
  assert.match(source, /recompensa por dar liquidez/);
  assert.match(source, /liquidity rewards/);
  assert.match(source, /weeklyRate: 0\.20/);
  assert.match(source, /\$\{liquidityRate\}% semanal/);
  assert.match(source, /\$\{liquidityRate\}% per week/);
  assert.match(source, /combo-slip PnL/);
  assert.match(source, /combinadas liquidadas/);
});
