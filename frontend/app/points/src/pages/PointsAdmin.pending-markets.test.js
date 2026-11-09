/**
 * Static checks for the Points pending-markets admin queue.
 *
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsAdmin.pending-markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('./PointsAdminWorkspace.jsx', import.meta.url), 'utf8');
const pendingApiSource = await readFile(new URL('../../../../api/points/admin/pending-markets.js', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const statsApiSource = await readFile(new URL('../../../../api/points/admin/stats.js', import.meta.url), 'utf8');
const pointsCss = await readFile(new URL('../points.css', import.meta.url), 'utf8');

function sourceForFunction(name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const nextFunction = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction);
}

test('Points admin exposes a re-add action for rejected generated markets', () => {
  assert.match(source, /filter === 'rejected'/);
  assert.match(source, /review\(r\.id,\s*'readd'\)/);
  assert.match(source, /Reagregar/);
  assert.match(apiSource, /adminReviewPendingMarket\(id,\s*action,\s*note\)/);
});

test('Points pending approval alerts include backend details', () => {
  const pendingTableSource = sourceForFunction('PendingMarketsTable');
  assert.match(pendingTableSource, /\$\{action\} falló/);
  assert.match(pendingTableSource, /e\.detail \? `\\n\$\{e\.detail\}` : ''/);
});

test('Points admin can edit generated markets and per-option liquidity before approval', () => {
  assert.match(source, /PendingMarketEditModal/);
  assert.match(source, /setEditingPending\(r\)/);
  assert.match(source, /adminEditPendingMarket/);
  assert.match(source, /seedLiquidities/);
  assert.match(source, /Liquidez opción/);
  assert.match(source, /MAX_PENDING_EDIT_OUTCOMES\s*=\s*64/);
  assert.match(source, /pendingSuggestedPricing/);
  assert.match(source, /formatSuggestedPricing/);
  assert.match(source, /pendingPricingProbabilities/);
  assert.match(source, /displayLiquiditiesForPendingRow/);
  assert.match(source, /reserveLiquiditiesFromDisplay/);
  assert.match(source, /useDisplayLiquidityWeights/);
  assert.match(source, /Odds sugeridos/);
  assert.match(source, /formatSuggestedPricingSource/);
  assert.match(source, /polymarket:/);
  assert.match(source, /Polymarket/);
  assert.doesNotMatch(source, /Field label="Icono"/);
  assert.match(source, /icon:\s*null/);
  assert.match(source, /outcomeImages/);
  assert.match(source, /Logo URL opcional/);
  assert.match(source, /outcomeImages:\s*cleanedImages/);
  assert.match(source, /seedLiquidities:\s*cleanedLiquidities/);
  assert.match(source, /Liquidez:/);
  assert.match(apiSource, /export async function adminEditPendingMarket/);
  assert.match(apiSource, /action:\s*'edit'/);
});

test('Points pending queue persists taxonomy filters and sends only displayed IDs for bulk actions', () => {
  const pendingTableSource = sourceForFunction('PendingMarketsTable');
  assert.match(pendingTableSource, /useAdminQueueFilters\(true\)/);
  assert.match(pendingTableSource, /<AdminQueueToolbar queue=\{queue\} proposal>/);
  assert.match(pendingTableSource, /const ids = proposals\.map\(row => row\.id\)/);
  assert.match(pendingTableSource, /action: 'approve_all', filters: \{ ids \}, preview: true/);
  assert.match(pendingTableSource, /bulkReview\.checks\.filter/);
  assert.match(pendingTableSource, /adminApproveAllPendingMarkets\(null, \{ ids \}\)/);
  assert.match(pendingTableSource, /adminRefreshAllPendingPricing\(\{ ids \}\)/);
  assert.match(workspaceSource, /useSearchParams\(\)/);
  for (const filter of ['category', 'sport', 'league', 'geo', 'topic', 'crypto_type', 'feature']) {
    assert.ok(workspaceSource.includes(`'${filter}'`));
  }
  assert.match(pendingApiSource, /id = ANY\(\$\{ids\}::int\[\]\)/);
  assert.match(pendingApiSource, /invalid_pending_market_ids/);
});

test('Points market automation shows a generation in-progress state under Sistema', () => {
  const tools = sourceForFunction('MarketAutomationTools');
  assert.match(source, /tab === 'launch'[\s\S]*?<MarketAutomationTools \/>/);
  assert.match(tools, /setGeneratingNow\(true\)[\s\S]*adminRunGenerators/);
  assert.match(tools, /setGeneratingNow\(false\)[\s\S]*setBulkBusy\(false\)/);
  assert.match(tools, /generatingNow \? 'Generando\.\.\.' : 'Generar propuestas'/);
});

test('Points pending queue keeps large generated fields readable', () => {
  assert.match(source, /function formatOutcomeList\(outcomes,\s*limit = 14\)/);
  assert.match(source, /Opciones \(\{Array\.isArray\(r\.outcomes\) \? r\.outcomes\.length : 0\}\): \{formatOutcomeList\(r\.outcomes\)\}/);
  assert.match(source, /<AdminMarketFacts market=\{r\} proposal \/>/);
  assert.match(workspaceSource, /market\.league/);
});

test('Points pending queue has a mobile-first review card layout', () => {
  const pendingTableSource = sourceForFunction('PendingMarketsTable');
  assert.match(pendingTableSource, /points-admin-pending-card/);
  assert.match(pendingTableSource, /points-admin-pending-title/);
  assert.match(pendingTableSource, /points-admin-pending-controls/);
  assert.match(pendingTableSource, /points-admin-pending-actions/);
  assert.match(pendingTableSource, /pb-admin-proposal-pricing/);
  assert.match(source, /points-admin-edit-meta/);
  assert.match(pointsCss, /\.points-admin-pending-title/);
  assert.match(pointsCss, /\.points-admin-pending-actions/);
  assert.match(pointsCss, /@media \(max-width: 720px\)[\s\S]*\.points-admin-pending-actions\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(pointsCss, /@media \(max-width: 720px\)[\s\S]*\.points-admin-pending-meta\s*\{[\s\S]*display: none/);
});

test('Points markets table has a mobile-first admin card layout', () => {
  const marketsTableSource = sourceForFunction('MarketsTable');
  assert.match(marketsTableSource, /points-admin-market-card/);
  assert.match(marketsTableSource, /points-admin-market-title/);
  assert.match(marketsTableSource, /points-admin-market-toggles/);
  assert.match(marketsTableSource, /points-admin-market-actions/);
  assert.match(marketsTableSource, /<AdminMarketFacts market=\{m\} \/>/);
  assert.match(source, /function MarketAdminMeta/);
  assert.match(source, /<MarketAdminMeta market=\{market\} \/>/);
  assert.match(pointsCss, /\.points-admin-market-card/);
  assert.match(pointsCss, /\.points-admin-market-actions/);
  assert.match(pointsCss, /@media \(max-width: 720px\)[\s\S]*\.points-admin-market-card\s*\{[\s\S]*flex-direction: column/);
  assert.match(pointsCss, /@media \(max-width: 720px\)[\s\S]*\.points-admin-market-meta\s*\{[\s\S]*display: none/);
  assert.match(pointsCss, /@media \(max-width: 720px\)[\s\S]*\.points-admin-market-actions\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test('Points admin overview opens actionable queues and explains unavailable counts', () => {
  assert.match(source, /tab !== 'overview'/);
  assert.match(source, /adminListTaskCounts\(\)/);
  assert.match(workspaceSource, /Conteo no disponible/);
  assert.match(workspaceSource, /admin\?tab=markets&status=pending/);
  assert.match(workspaceSource, /admin\?tab=support/);
  assert.match(workspaceSource, /admin\?tab=social/);
  assert.match(workspaceSource, /counts\.resolutionReady/);
  assert.match(workspaceSource, /counts\.closedWithoutCandidate/);
});

test('Points nav surfaces admin work count outside admin', () => {
  assert.match(navSource, /adminListTaskCounts/);
  assert.match(navSource, /adminTaskTotal/);
  assert.match(navSource, /points\.nav\.admin/);
  assert.match(navSource, /adminTaskTotal > 0/);
});

test('Points nav exposes a compact mobile menu with identity and hidden routes', () => {
  assert.match(navSource, /points-mobile-menu/);
  assert.match(navSource, /points-mobile-menu-user/);
  assert.match(navSource, /user\?\.username/);
  assert.match(navSource, /formatBalance/);
  assert.match(navSource, /minimumFractionDigits: 2/);
  assert.match(navSource, /balanceLabel/);
  assert.match(navSource, /points\.nav\.howItWorks/);
  assert.match(navSource, /points-lang-toggle/);
  assert.match(navSource, /points-theme-toggle/);
  assert.doesNotMatch(navSource, /🇺🇸|🇲🇽|btn-theme-toggle|☀|☾/);
  assert.match(navSource, /setMobileMenuOpen/);
});

test('Points admin can pause public cycles and restart them later', () => {
  assert.match(source, /adminPauseCycles/);
  assert.match(source, /Pausar ciclos/);
  assert.match(source, /Reanudar ciclos/);
  assert.match(source, /adminApplyPreCycleCarryover/);
  assert.match(source, /Aplicar bonos preciclo/);
  assert.match(apiSource, /export async function adminApplyPreCycleCarryover/);
  assert.match(apiSource, /apply_pre_cycle_carryover/);
  assert.match(apiSource, /export async function adminPauseCycles/);
  assert.match(apiSource, /action:\s*'pause'/);
});

test('Points admin can download tournament standings as a PNG snapshot', () => {
  assert.match(source, /adminFetchCycleStandingsSnapshot/);
  assert.match(source, /buildTournamentStandingsSvg/);
  assert.match(source, /downloadTournamentStandingsPng/);
  assert.match(source, /Descargar standings PNG/);
  assert.match(apiSource, /export async function adminFetchCycleStandingsSnapshot/);
  assert.match(apiSource, /standings_snapshot/);
  assert.match(source, /image\/png/);
  assert.match(source, /image\/svg\+xml/);
});

test('Points admin can export conviction multiplier audit CSV', () => {
  assert.match(source, /CONVICTION_AUDIT_ROW_LIMIT = 5000/);
  assert.match(source, /buildConvictionAuditCsv/);
  assert.match(source, /convictionBreakdown/);
  assert.match(source, /conviction_bonus_gross_mxnp/);
  assert.match(source, /market_net_pnl_mxnp/);
  assert.match(source, /text\/csv;charset=utf-8/);
  assert.match(source, /Descargar convicción CSV/);
});

test('Points admin has an October launch readiness checklist', () => {
  assert.match(source, /LaunchReadinessPanel/);
  assert.match(source, /OCTOBER_REQUIRED_CRONS/);
  assert.match(source, /adminFetchPointsHealth/);
  assert.match(source, /adminRunGenerators\(\{ dry: true \}\)/);
  assert.match(source, /adminRunAutoResolve\(\{ dry: true \}\)/);
  assert.match(source, /docs\/OCTOBER_TOURNAMENT_READINESS\.md/);
  assert.match(source, /Reset dry-run y ciclo mensual/);
  assert.match(source, /Previsualizar reset/);
  assert.match(source, /leaderboard anterior quede solo en historial Top 10/);
  assert.match(apiSource, /export async function adminFetchPointsHealth/);
});

test('Points admin launch tab includes a proactive resolution watchlist', () => {
  assert.match(source, /ResolutionWatchlist/);
  assert.match(source, /buildResolutionWatchlist/);
  assert.match(source, /diagnostic\.manual/);
  assert.match(source, /diagnostic\.missingResolver/);
  assert.match(source, /diagnostic\.waitingWindow/);
  assert.match(source, /Manual ops before close/);
  assert.match(source, /Missing resolver/);
  assert.match(source, /Correr Retrofit o editar resolver antes del cierre/);
});

test('Points markets expose a direct resolution queue with a linked detail panel', () => {
  assert.match(workspaceSource, /tab === 'markets' && params\.get\('status'\) === 'pending'/);
  assert.match(workspaceSource, /next\.set\('item', id\)/);
  assert.match(workspaceSource, /row\.resolutionCandidate/);
  assert.match(workspaceSource, /Cerrado · sin propuesta/);
  assert.match(source, /<AdminMarketQueue rows=\{markets\} loading=\{loading\} error=\{error\}/);
});

test('Points admin can append players to active parallel markets', () => {
  assert.match(source, /adminAppendParallelOutcomes/);
  assert.match(source, /AppendParallelOutcomesModal/);
  assert.match(source, /Agregar jugador/);
  assert.match(source, /m\.ammMode === 'parallel'/);
  assert.match(source, /Jugadores nuevos o existentes/);
  assert.match(source, /outcomes:\s*unique/);
  assert.match(source, /outcomeImages/);
  assert.match(source, /resolverLegs/);
  assert.match(source, /Sungjae Im \| 11382/);
  assert.match(apiSource, /export async function adminAppendParallelOutcomes/);
  assert.match(apiSource, /\/api\/points\/admin\/append-parallel-outcomes/);
});

test('Points admin can convert UFC parallel markets without current exposure to binary', () => {
  assert.match(source, /canConvertParallelToBinary/);
  assert.match(source, /resolverSource === 'espn-mma'/);
  assert.match(source, /league === 'ufc'/);
  assert.match(source, /convertParallelMarketToBinary/);
  assert.match(source, /adminConvertParallelToBinary/);
  assert.match(source, /A binario/);
  assert.match(source, /Los trades históricos cerrados no bloquean/);
  assert.doesNotMatch(source, /detail\.trades/);
  assert.match(apiSource, /export async function adminConvertParallelToBinary/);
  assert.match(apiSource, /\/api\/points\/admin\/convert-parallel-binary/);
});

test('Points admin can edit active market logos and repair active parallel market reserves', () => {
  assert.match(source, /normalizeParallelReserveRows/);
  assert.match(source, /parallelYesProbabilityFromReserves/);
  assert.match(source, /Imagen del mercado/);
  assert.match(source, /initialMarketImageUrl/);
  assert.match(source, /market=\{market\}/);
  assert.match(source, /imageUrl:\s*imageUrlPatch/);
  assert.match(source, /Logos de opciones/);
  assert.match(source, /initialOutcomeImages/);
  assert.match(source, /updateOutcomeImage/);
  assert.match(source, /outcomeImages:\s*outcomeImagePatch/);
  assert.match(source, /Reservas Sí\/No/);
  assert.match(source, /Reserva Sí/);
  assert.match(source, /Reserva No/);
  assert.match(source, /Más reserva No = Sí más alto/);
  assert.match(source, /parallelLegs:\s*parallelLegPatches/);
  const editPayload = apiSource.match(/postJson\('\/api\/points\/admin\/edit-market', \{([^}]+)\}\)/)?.[1];
  assert.ok(editPayload, 'expected edit-market request payload');
  const fields = editPayload.split(',').map(field => field.trim());
  for (const field of ['imageUrl', 'outcomeImages', 'parallelLegs', 'finalScore']) {
    assert.ok(fields.includes(field), `edit payload should include ${field}`);
  }
});

test('Points admin time edits do not block on untouched depleted parallel reserves', () => {
  const editModalSource = sourceForFunction('EditMarketModal');
  assert.match(editModalSource, /const changed = !initial[\s\S]+Math\.abs\(noReserve - Number\(initial\.noReserve\)\) > 0\.000001;/);
  assert.match(editModalSource, /if \(!changed\) continue;[\s\S]+Cada reserva Sí\/No debe ser de al menos 100 MXNP/);
  assert.match(editModalSource, /patches\.push\(\{ id: row\.id, yesReserve, noReserve \}\)/);
});

test('Points pending admin can set 24h crypto windows and toggle BTC/ETH generation', () => {
  assert.match(source, /DEFAULT_CRYPTO_INTERVAL_OPTIONS[\s\S]*720[\s\S]*12 horas[\s\S]*1440[\s\S]*24 horas/);
  assert.match(source, /DEFAULT_CRYPTO_ASSET_OPTIONS[\s\S]*btc[\s\S]*eth/);
  assert.match(source, /enabledCryptoAssetKeys/);
  assert.match(source, /saveCryptoAssetToggle/);
  assert.match(source, /enabledAssets:\s*enabledCryptoAssetKeys/);
  assert.match(source, /type="checkbox"/);
});

test('Points admin can review scheduler resolution candidates', () => {
  assert.match(source, /ResolutionCandidatePanel/);
  assert.match(source, /resolutionCandidate/);
  assert.match(source, /adminReviewResolutionCandidate/);
  assert.match(source, /candidate\.needsOutcome/);
  assert.match(source, /Elegir resultado/);
  assert.match(source, /reviewing \|\| !canConfirm/);
  assert.match(source, /reviewSettlement\('candidate', market, selectedOutcome, candidate\)/);
  assert.match(source, /Confirmar resolución/);
  assert.match(source, /Negar/);
  assert.match(source, /En revisión/);
  assert.match(apiSource, /export async function adminReviewResolutionCandidate/);
});

test('Points admin can bulk-hide or show public markets and mark tournament overrides', () => {
  assert.match(source, /toggleHomeMarketsVisibility/);
  assert.match(source, /Revisar visibilidad pública/);
  assert.match(source, /wouldShowCount/);
  assert.match(source, /wouldHideCount/);
  assert.match(source, /listas públicas/);
  assert.match(source, /suggestedAction/);
  assert.match(source, /adminBulkHideMarkets/);
  assert.match(source, /toggleTournamentFeaturedMarket/);
  assert.match(source, /togglePendingTournamentFeatured/);
  assert.match(source, /tournamentFeatured/);
  assert.match(source, /pendingTournamentFeatured/);
  assert.match(source, /🏆/);
  assert.match(apiSource, /export async function adminBulkHideMarkets/);
  assert.match(apiSource, /\/api\/points\/admin\/bulk-hide-markets/);
  assert.match(apiSource, /action/);
  assert.match(apiSource, /tournamentFeatured/);
});

test('Points admin does not expose one-off World Cup repair/progress buttons', () => {
  assert.doesNotMatch(source, /adminProgressWorldCup/);
  assert.doesNotMatch(source, /progressWorldCup/);
  assert.doesNotMatch(source, /Reparar Mundial/);
  assert.doesNotMatch(source, /Progresar Mundial/);
  assert.doesNotMatch(apiSource, /export async function adminProgressWorldCup/);
});

test('Points admin can cancel active and por resolver markets', () => {
  assert.match(source, /adminCancelMarket/);
  assert.match(source, /adminReopenCanceledMarket/);
  assert.match(source, /Anular mercado/);
  assert.match(source, /reopenCanceledMarket/);
  assert.match(source, /A pendientes/);
  assert.match(source, /En pendientes/);
  assert.match(source, /pendingStatus === 'pending'/);
  assert.match(source, /El mercado anulado seguirá anulado y reembolsado/);
  assert.match(source, /filter === 'pending'/);
  assert.match(source, /reviewSettlement\('cancel', m\)/);
  assert.match(source, /onCancel=\{market => reviewSettlement\('cancel', market\)\}/);
  assert.match(source, /actionMode === 'cancel'/);
  assert.match(source, /adminCancelMarket\(\{ marketId: market.id, reason \}\)/);
  assert.match(apiSource, /export async function adminReopenCanceledMarket/);
  assert.match(apiSource, /\/api\/points\/admin\/reopen-canceled-market/);
});

test('Points admin stats shows signup sheet and per-user distribution detail', () => {
  assert.match(source, /AdminUserSignupPanel/);
  assert.match(source, /Usuarios registrados/);
  assert.match(source, /ADMIN_USER_SIGNUP_PAGE_SIZE = 50/);
  assert.match(source, /userLimit/);
  assert.match(source, /userOffset/);
  assert.match(source, /userSearch/);
  assert.match(source, /Buscar usuario, email o teléfono/);
  assert.match(source, /Anterior/);
  assert.match(source, /Siguiente/);
  assert.match(source, /row\.email/);
  assert.match(source, /row\.phoneNumber/);
  assert.match(source, /Sin teléfono/);
  assert.match(source, /row\.publicitySource/);
  assert.match(source, /AdminDistributionsPanel/);
  assert.match(source, /Distribuciones por usuario/);
  assert.match(source, /userRow\.username/);
  assert.match(source, /adminSignedMxnp/);
  assert.match(statsApiSource, /userSignups:/);
  assert.match(statsApiSource, /distributionUserRows/);
  assert.match(statsApiSource, /points_publicity_attributions/);
});

test('Points admin has a command center for hidden expiring social post tasks', () => {
  assert.match(source, /adminCreateSocialTaskCampaign/);
  assert.match(source, /adminDeactivateSocialTaskCampaign/);
  assert.match(source, /Centro de tareas/);
  assert.match(source, /Posts ocultos/);
  assert.match(source, /reward:\s*'100'/);
  assert.match(source, /URL del post/);
  assert.match(source, /Crear link/);
  assert.match(source, /Links temporales/);
  assert.match(source, /campaignShareUrl/);
  assert.match(source, /Ver post/);
  assert.match(source, /t\.proof_url && t\.proof_url !== t\.target_url/);
  assert.match(apiSource, /export async function adminCreateSocialTaskCampaign/);
  assert.match(apiSource, /action:\s*'create_campaign'/);
  assert.match(apiSource, /export async function adminDeactivateSocialTaskCampaign/);
  assert.match(apiSource, /action:\s*'deactivate_campaign'/);
});

test('Points admin social task queue filters review items by network', () => {
  const socialQueueSource = sourceForFunction('SocialTasksQueue');
  assert.match(source, /const SOCIAL_TASK_NETWORK_FILTERS = \[/);
  assert.match(source, /id:\s*'tiktok'[\s\S]*label:\s*'TikTok'/);
  assert.match(source, /id:\s*'instagram'[\s\S]*label:\s*'Instagram'/);
  assert.match(source, /id:\s*'x'[\s\S]*label:\s*'X'/);
  assert.match(source, /function normalizeSocialTaskPlatform\(task\)/);
  assert.match(source, /task\?\.task_key \|\| task\?\.taskKey \|\| task\?\.key/);
  assert.match(source, /key\.startsWith\('tiktok_'\)/);
  assert.match(source, /key\.startsWith\('instagram_'\)/);
  assert.match(source, /key\.startsWith\('twitter_'\)/);
  assert.match(source, /key\.startsWith\('x_'\)/);
  assert.match(source, /function socialTaskPlatformLabel\(task\)/);
  assert.match(socialQueueSource, /const \[networkFilter,\s*setNetworkFilter\] = useState\('all'\)/);
  assert.match(socialQueueSource, /aria-label="Filtrar tareas sociales por red"/);
  assert.match(socialQueueSource, /normalizeSocialTaskPlatform\(task\) === filter\.id/);
  assert.match(socialQueueSource, /visibleTasks\.map\(t =>/);
  assert.match(socialQueueSource, /socialTaskPlatformLabel\(t\)/);
});

test('Points admin social task tabs show review history details', () => {
  assert.match(source, /Sin tareas aprobadas todavía/);
  assert.match(source, /Sin tareas rechazadas todavía/);
  assert.match(source, /Sin historial de revisiones todavía/);
  assert.match(source, /review_id/);
  assert.match(source, /Usuario: @/);
  assert.match(source, /function socialTaskAccountText\(task\)/);
  assert.match(source, /Cuenta \{socialTaskPlatformLabel\(t\)\}: \{socialTaskAccountText\(t\)\}/);
  assert.match(source, /Enviada:/);
  assert.match(source, /Revisada:/);
  assert.match(source, /Admin: @/);
});
