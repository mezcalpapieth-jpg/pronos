/**
 * Static checks for canceled points markets in the detail and portfolio UI.
 *
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.cancelled.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const portfolioSource = await readFile(new URL('./PointsPortfolio.jsx', import.meta.url), 'utf8');

test('Points detail shows canceled markets as annulled instead of pending', () => {
  assert.match(detailSource, /isCanceled/);
  assert.match(detailSource, /ANULADO/);
  assert.match(detailSource, /Mercado anulado/);
  assert.match(detailSource, /Las posiciones abiertas fueron devueltas/);
});

test('Points portfolio history labels canceled markets neutrally', () => {
  assert.match(portfolioSource, /marketsCanceled/);
  assert.match(portfolioSource, /ANULADO/);
  assert.match(portfolioSource, /canceled:/);
});
