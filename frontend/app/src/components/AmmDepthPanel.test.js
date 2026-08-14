/**
 * Static checks for the MVP AMM depth panel.
 *
 * Run with:
 *   node --test frontend/app/src/components/AmmDepthPanel.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelSource = await readFile(new URL('./AmmDepthPanel.jsx', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('../pages/MarketDetail.jsx', import.meta.url), 'utf8');

test('AMM depth panel fetches the protocol depth endpoint and stays Spanish-first', () => {
  assert.match(panelSource, /\/api\/protocol\/depth\?/);
  assert.match(panelSource, /Liquidez AMM/);
  assert.match(panelSource, /Compra/);
  assert.match(panelSource, /Venta/);
  assert.match(panelSource, /Impacto/);
  assert.match(panelSource, /curva del pool/);
  assert.doesNotMatch(panelSource, /Apostar/);
  assert.doesNotMatch(panelSource, /Order book|Libro de órdenes/i);
});

test('market detail wires the AMM depth panel to the currently highlighted outcome', () => {
  assert.match(detailSource, /import AmmDepthPanel from '\.\.\/components\/AmmDepthPanel\.jsx';/);
  assert.match(detailSource, /const \[depthOutcomeIndex, setDepthOutcomeIndex\] = useState\(0\);/);
  assert.match(detailSource, /onMouseEnter=\{\(\) => setDepthOutcomeIndex\(i\)\}/);
  assert.match(detailSource, /onFocus=\{\(\) => setDepthOutcomeIndex\(i\)\}/);
  assert.match(detailSource, /<AmmDepthPanel/);
  assert.match(detailSource, /outcomeIndex=\{displayOutcomeIndices\[depthOutcomeIndex\] \?\? 0\}/);
  assert.match(detailSource, /outcomeLabel=\{displayOutcomes\[depthOutcomeIndex\]\}/);
});
