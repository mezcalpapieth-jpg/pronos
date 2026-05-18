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
const taskCountsSource = await readFile(new URL('../lib/mvpAdminTaskCounts.js', import.meta.url), 'utf8');

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

  assert.match(source, /from '\.\.\/lib\/mvpAdminMarketFilters\.js'/);
  assert.match(source, /DEFAULT_CATEGORY_ICONS/);
  assert.doesNotMatch(createForm, /\{c\.icon\}\s*\{c\.label\}/);
  assert.match(createForm, /icon,\s*\n\s*sport:\s*sport \|\| null,/);
  assert.match(createForm, /league:\s*league \|\| null,/);
  assert.match(createForm, /categoryTags:\s*categoryTagsForCreate,/);
  assert.match(createForm, /geoTags:\s*geoTagsForCreate,/);
  assert.match(createForm, /topicTags:\s*topicTagsForCreate,/);
  assert.match(createForm, /category === 'mexico'/);
  assert.match(createForm, /outcomeImages:\s*hasAnyImage \? trimmedImages : null,/);
});

test('MVP admin market filters are emoji-free and expose category subfilters', () => {
  const marketsList = section('function MarketsList', 'function SocialTasksSection');

  assert.match(marketsList, /sportFilter/);
  assert.match(marketsList, /leagueFilter/);
  assert.match(marketsList, /cryptoTypeFilter/);
  assert.match(marketsList, /geoFilter/);
  assert.match(marketsList, /topicFilter/);
  assert.match(marketsList, /showMexicoFilters/);
  assert.match(marketsList, /ADMIN_GEO_FILTERS\.map/);
  assert.match(marketsList, /ADMIN_MEXICO_TOPIC_FILTERS\.map/);
  assert.match(marketsList, /filterProtocolAdminMarkets/);
  assert.doesNotMatch(marketsList, /\{tab\.icon\}\s*\{tab\.label\}/);
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
  assert.match(adminShell, /resolutionData\.data\?\.count/);
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
  assert.match(source, /pendingResolveCount=\{adminTaskCounts\.pendingResolve\}/);
  assert.match(source, /disputedCount=\{adminTaskCounts\.disputed\}/);
  assert.match(source, /function MarketsList\(\{ refreshKey, bumpRefresh, onQueueChange, pendingResolveCount = 0, disputedCount = 0 \}\)/);
  assert.match(source, /filter === 'pending' && !loading \? visible\.length : pendingResolveCount/);
  assert.match(source, /tab\.value === 'pending' \? pendingBadgeCount/);
  assert.match(source, /tab\.value === 'disputed' \? disputedCount/);
  assert.match(source, /statusTaskCount > 0/);
});

test('MVP admin markets has a Por resolver filter for overdue active markets', () => {
  const marketsList = source;

  assert.match(marketsList, /value:\s*'pending',\s*label:\s*'Por resolver'/);
  assert.match(marketsList, /filter === 'pending' \? 'active' : filter/);
  assert.match(marketsList, /endTime/);
  assert.match(marketsList, /m\.resolutionCandidate/);
  assert.match(marketsList, /new Date\(m\.endTime\)\.getTime\(\) <= Date\.now\(\)/);
  assert.match(source, /Number\(resolutionData\.data\?\.count \|\| 0\)/);
  assert.doesNotMatch(source, /Number\(resolutionData\.data\?\.pendingCount \|\| 0\) \+ Number\(resolutionData\.data\?\.overdueCount \|\| 0\)/);
});

test('MVP admin can cancel and dispute on-chain markets through the protocol lifecycle shell', () => {
  const marketsList = section('function MarketsList', 'export default function Admin');
  const editModal = section('function EditMarketModal', '// ═══ Markets list');

  assert.match(source, /value:\s*'disputed',\s*label:\s*'En disputa'/);
  assert.match(source, /value:\s*'canceled',\s*label:\s*'Anulados'/);
  assert.match(marketsList, /postJson\('\/api\/protocol\/admin\/lifecycle-market'/);
  assert.match(marketsList, /handleLifecycle\(m,\s*'cancel'\)/);
  assert.match(marketsList, /handleLifecycle\(m,\s*'dispute'\)/);
  assert.match(marketsList, /handleLifecycle\(m,\s*'clear_dispute'\)/);
  assert.match(marketsList, /Anular mercado/);
  assert.match(marketsList, /Abrir disputa/);
  assert.match(marketsList, /Cerrar disputa/);
  assert.match(editModal, /actionMode === 'cancel'/);
  assert.match(editModal, /Anular mercado/);
});

test('MVP admin badges include disputed on-chain markets', () => {
  assert.match(source, /disputed:\s*0/);
  assert.match(source, /\/api\/protocol\/markets\?status=disputed/);
  assert.match(taskCountsSource, /\/api\/protocol\/markets\?status=disputed/);
  assert.match(taskCountsSource, /disputed/);
  assert.match(taskCountsSource, /markets:\s*pendingResolve \+ disputed/);
});
