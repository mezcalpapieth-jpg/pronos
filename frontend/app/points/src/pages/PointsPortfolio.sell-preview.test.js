import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsPortfolio.jsx', import.meta.url), 'utf8');

test('portfolio sell flow previews the real AMM quote before executing', () => {
  assert.match(source, /setSellPreview\(/);
  assert.match(source, /quoteSell\(\{/);
  assert.match(source, /buildSellPreview\(/);
  assert.match(source, /minCollateralOut:\s*preview\.minCollateralOut/);
  assert.match(source, /SALIDA REAL/);
  assert.match(source, /IMPACTO POR LIQUIDEZ/);
});

test('portfolio history displays losing PnL instead of hiding lost rows', () => {
  assert.match(source, /historyPnlValue\(m\)/);
  assert.doesNotMatch(source, /outcomeStatus\s*!==\s*'lost'/);
});
