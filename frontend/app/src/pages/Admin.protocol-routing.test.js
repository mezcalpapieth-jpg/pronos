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
const navSource = await readFile(new URL('../components/Nav.jsx', import.meta.url), 'utf8');

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
  assert.match(marketsList, /postJson\('\/api\/protocol\/admin\/resolution-candidates'/);
  assert.match(marketsList, /Resolución sugerida/);
  assert.match(marketsList, /Confirmar resolución/);
  assert.match(marketsList, /Negar/);
  assert.doesNotMatch(marketsList, /\/api\/points\/admin\/resolve-market/);
});

test('MVP admin status panel uses protocol mainnet wiring', () => {
  const statusPanel = section('function OnchainStatusPanel', 'function short');

  assert.match(source, /VITE_ONCHAIN_CHAIN_ID \|\| 42161/);
  assert.match(statusPanel, /getJson\('\/api\/protocol\/admin\/onchain-status'/);
  assert.doesNotMatch(statusPanel, /\/api\/points\/admin\/onchain-status/);
});

test('MVP admin status panel surfaces Turnkey and deployment readiness fields', () => {
  const statusPanel = section('function OnchainStatusPanel', 'function short');

  assert.match(statusPanel, /ONCHAIN_RESOLVER_SUBORG_ID/);
  assert.match(statusPanel, /ONCHAIN_RESOLVER_ADDRESS/);
  assert.match(statusPanel, /TURNKEY_ORGANIZATION_ID/);
  assert.match(statusPanel, /TURNKEY_API_PUBLIC_KEY/);
  assert.match(statusPanel, /VITE_TURNKEY_ORGANIZATION_ID/);
  assert.match(statusPanel, /ONCHAIN_MARKET_POOL_ADDRESSES/);
  assert.match(statusPanel, /INDEXER_KEY/);
  assert.match(statusPanel, /CRON_SECRET/);
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

test('MVP generated market review uses protocol-owned queue endpoints', () => {
  const generatorsSection = section('function GeneratorsSection', '// ═══ Pending-markets review');
  const pendingSection = section('function PendingMarketsSection', '// ═══ Create-market form');
  const approveForm = section('function ApproveOnchainForm', 'function PendingMarketsSection');

  assert.match(generatorsSection, /\/api\/protocol\/admin\/run-generators/);
  assert.match(pendingSection, /\/api\/protocol\/admin\/pending-markets/);
  assert.match(approveForm, /\/api\/protocol\/admin\/pending-markets/);
  assert.doesNotMatch(generatorsSection, /\/api\/points\/admin\/run-generators/);
  assert.doesNotMatch(pendingSection, /\/api\/points\/admin\/pending-markets/);
  assert.doesNotMatch(approveForm, /\/api\/points\/admin\/pending-markets/);
});

test('MVP admin tabs show badges for pending work outside the active tab', () => {
  const adminShell = source;

  assert.match(adminShell, /adminTaskCounts/);
  assert.match(adminShell, /\/api\/protocol\/admin\/pending-markets\?status=pending/);
  assert.match(adminShell, /\/api\/protocol\/admin\/resolution-candidates\?status=pending/);
  assert.match(adminShell, /\/api\/points\/admin\/social-tasks\?status=pending/);
  assert.match(adminShell, /overdueCount/);
  assert.match(adminShell, /tab !== t\.id/);
  assert.match(adminShell, /taskCount > 0/);
});

test('MVP nav surfaces admin work count outside admin', () => {
  assert.match(navSource, /adminListMvpTaskCounts/);
  assert.match(navSource, /adminTaskTotal/);
  assert.match(navSource, /nav\.admin/);
  assert.match(navSource, /adminTaskTotal > 0/);
});

test('MVP markets filter surfaces por resolver count while inside Mercados', () => {
  assert.match(source, /pendingResolveCount=\{adminTaskCounts\.markets\}/);
  assert.match(source, /function MarketsList\(\{ refreshKey, bumpRefresh, onQueueChange, pendingResolveCount = 0 \}\)/);
  assert.match(source, /tab\.value === 'pending' \? pendingResolveCount : 0/);
  assert.match(source, /statusTaskCount > 0/);
});

test('MVP admin markets has a Por resolver filter for overdue active markets', () => {
  const marketsList = source;

  assert.match(marketsList, /value:\s*'pending',\s*label:\s*'Por resolver'/);
  assert.match(marketsList, /filter === 'pending' \? 'active' : filter/);
  assert.match(marketsList, /endTime/);
  assert.match(marketsList, /new Date\(m\.endTime\)\.getTime\(\) <= Date\.now\(\)/);
});
