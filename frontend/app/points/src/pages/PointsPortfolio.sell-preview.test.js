import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsPortfolio.jsx', import.meta.url), 'utf8');
const earnSource = await readFile(new URL('./PointsEarn.jsx', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');

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

test('portfolio uses responsive class hooks for mobile layout', () => {
  assert.match(source, /points-portfolio-layout/);
  assert.match(source, /points-portfolio-stats/);
  assert.match(source, /points-portfolio-sidebar/);
  assert.match(source, /points-daily-claim-card/);
  assert.match(source, /points-history-summary-grid/);
});

test('portfolio and earn page labels use points translations', () => {
  assert.match(source, /useT\(\)/);
  assert.match(source, /points\.portfolio\.title/);
  assert.match(source, /points\.portfolio\.tab\.open/);
  assert.match(source, /points\.portfolio\.tab\.history/);
  assert.match(earnSource, /useT\(\)/);
  assert.match(earnSource, /points\.earn\.title/);
  assert.match(i18nSource, /'points\.portfolio\.title':\s*\{\s*es:\s*'Portafolio',\s*en:\s*'Portfolio'/);
  assert.match(i18nSource, /'points\.nav\.earn':\s*\{\s*es:\s*'Gana MXNP',\s*en:\s*'Earn MXNP'/);
  assert.match(i18nSource, /'points\.earn\.title':\s*\{\s*es:\s*'Gana MXNP',\s*en:\s*'Earn MXNP'/);
});
