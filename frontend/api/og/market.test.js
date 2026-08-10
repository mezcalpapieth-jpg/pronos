/**
 * Run with:
 *   node --test frontend/api/og/market.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./market.js', import.meta.url), 'utf8');

test('market OG image renders the Pronos ticket share style', () => {
  assert.match(source, /cleanAccount/);
  assert.match(source, /cashout/);
  assert.match(source, /Ganó en/);
  assert.match(source, /Cobro/);
  assert.match(source, /Costo/);
  assert.match(source, /Prob\./);
  assert.doesNotMatch(source, /Cash Out/);
  assert.doesNotMatch(source, /Won on/);
  assert.match(source, /dot-grid/);
  assert.match(source, /ticket-shadow/);
  assert.match(source, /stroke-dasharray="3 10"/);
  assert.match(source, /svgTextFit/);
  assert.match(source, /Pronos/);
  assert.match(source, />P<\/text>/);
});

test('market OG image accepts account and cash-out query params', () => {
  assert.match(source, /req\.query\.account \|\| req\.query\.username \|\| req\.query\.user/);
  assert.match(source, /req\.query\.cashout \|\| req\.query\.cashOut \|\| req\.query\.amount/);
  assert.match(source, /req\.query\.cost/);
  assert.match(source, /req\.query\.odds/);
  assert.match(source, /req\.query\.outcome \|\| req\.query\.side/);
  assert.match(source, /@pronos_io/);
});
