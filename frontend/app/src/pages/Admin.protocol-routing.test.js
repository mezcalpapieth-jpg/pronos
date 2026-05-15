/**
 * Static routing checks for the MVP admin page.
 *
 * Run with:
 *   node --test frontend/app/src/pages/Admin.protocol-routing.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./Admin.jsx', import.meta.url), 'utf8');

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('manual MVP create deploys through the protocol admin API', () => {
  const createForm = section('function CreateMarketForm', '// ═══ Edit-market modal');

  assert.match(createForm, /postJson\('\/api\/protocol\/admin\/create-market'/);
  assert.doesNotMatch(createForm, /\/api\/points\/admin\/create-market/);
  assert.match(createForm, /seedAmount:\s*Number\(seed\)/);
  assert.doesNotMatch(createForm, /seedLiquidity:\s*Number\(seed\)/);
});

test('MVP admin market list and resolution use protocol data', () => {
  const marketsList = section('function MarketsList', 'export default function Admin');

  assert.match(marketsList, /\/api\/protocol\/markets\?/);
  assert.doesNotMatch(marketsList, /\/api\/points\/admin\/markets\?/);
  assert.match(marketsList, /postJson\('\/api\/protocol\/admin\/resolve-market'/);
  assert.doesNotMatch(marketsList, /\/api\/points\/admin\/resolve-market/);
});

test('MVP admin status panel uses protocol mainnet wiring', () => {
  const statusPanel = section('function OnchainStatusPanel', 'function short');

  assert.match(source, /VITE_ONCHAIN_CHAIN_ID \|\| 42161/);
  assert.match(statusPanel, /getJson\('\/api\/protocol\/admin\/onchain-status'/);
  assert.doesNotMatch(statusPanel, /\/api\/points\/admin\/onchain-status/);
});

test('MVP admin category and create form stay aligned with points taxonomy metadata', () => {
  const createForm = section('function CreateMarketForm', '// ═══ Edit-market modal');

  assert.match(source, /value:\s*'world-cup',\s*label:\s*'Copa del Mundo'/);
  assert.match(source, /value:\s*'mexico',\s*label:\s*'Mexico & Latam'/);
  assert.match(createForm, /icon,\s*\n\s*sport:\s*sport \|\| null,/);
  assert.match(createForm, /league:\s*league \|\| null,/);
  assert.match(createForm, /outcomeImages:\s*hasAnyImage \? trimmedImages : null,/);
});

test('MVP generated queue can inspect and re-add rejected markets', () => {
  const pendingSection = section('function PendingMarketsSection', '// ═══ Create-market form');

  assert.match(pendingSection, /status=\$\{filter\}/);
  assert.match(pendingSection, /\['pending',\s*'rejected'\]/);
  assert.match(pendingSection, /action:\s*'readd'/);
  assert.match(pendingSection, /Reagregar/);
});
