import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import { buildSellPreview } from '../lib/sellPreview.js';

const source = await readFile(new URL('./PointsSellPreviewModal.jsx', import.meta.url), 'utf8');
const module = { exports: {} };
new Function('require', 'module', 'exports', transformSync(source, { loader: 'jsx', format: 'cjs' }).code)(
  createRequire(import.meta.url), module, module.exports,
);
const Modal = module.exports.default;

function renderQuote(quote, mode = 'onchain') {
  const position = { mode, shares: 2, costBasis: 1, currentValue: 1.04, outcomeLabel: 'Sí' };
  return renderToStaticMarkup(React.createElement(Modal, {
    state: { position, preview: buildSellPreview(position, { shares: 1, ...quote }) },
  }));
}

test('on-chain sell confirmation renders gross, effective fee and six-decimal net payout', () => {
  const html = renderQuote({ gross: 0.522535, fee: 0.013684, feePct: (0.013684 / 0.522535) * 100, collateralOut: 0.508851 });
  assert.match(html, /Importe bruto/);
  assert.match(html, /0\.522535 MXNP/);
  assert.match(html, /Comisión \(2\.6188%\)/);
  assert.match(html, /0\.013684 MXNP/);
  assert.match(html, /0\.508851 MXNP/);
  assert.match(html, /La salida real ya incluye el descuento de la comisión/);
  assert.doesNotMatch(html, /0\.495167 MXNP/); // fee must not be deducted twice
});

test('a minimum-unit fee remains visible and multi-outcome sells explicitly show zero fee', () => {
  const tiny = renderQuote({ gross: 0.000002, fee: 0.000001, feePct: 50, collateralOut: 0.000001 });
  assert.match(tiny, /0\.000001 MXNP/);
  assert.match(tiny, /Comisión \(50\.0000%\)/);
  const multi = renderQuote({ gross: 0.522535, fee: 0, feePct: 0, collateralOut: 0.522535 });
  assert.match(multi, /Comisión \(0\.0000%\)/);
  assert.match(multi, /0\.000000 MXNP/);
});

test('Points sell confirmations retain two-decimal payouts without the on-chain breakdown', () => {
  const html = renderQuote({ gross: 0.522535, fee: 0.013684, feePct: 2.6188, collateralOut: 0.508851 }, 'points');
  assert.match(html, /0\.51 MXNP/);
  assert.doesNotMatch(html, /Importe bruto|Comisión|0\.508851/);
});
