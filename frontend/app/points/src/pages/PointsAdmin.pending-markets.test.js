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
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const statsApiSource = await readFile(new URL('../../../../api/points/admin/stats.js', import.meta.url), 'utf8');

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

test('Points pending queue has taxonomy filters and filtered bulk actions', () => {
  const pendingTableSource = sourceForFunction('PendingMarketsTable');
  assert.match(pendingTableSource, /function PendingMarketsTable\(\{ onQueueChange \}\)/);
  assert.match(pendingTableSource, /const \[categoryFilter,\s*setCategoryFilter\]/);
  assert.match(pendingTableSource, /const \[sportFilter,\s*setSportFilter\]/);
  assert.match(pendingTableSource, /const \[leagueFilter,\s*setLeagueFilter\]/);
  assert.match(pendingTableSource, /const \[cryptoTypeFilter,\s*setCryptoTypeFilter\]/);
  assert.match(pendingTableSource, /const \[geoFilter,\s*setGeoFilter\]/);
  assert.match(pendingTableSource, /const \[topicFilter,\s*setTopicFilter\]/);
  assert.match(pendingTableSource, /const \[curationFilter,\s*setCurationFilter\]/);
  assert.match(pendingTableSource, /pendingCurationFilters/);
  assert.match(pendingTableSource, /key:\s*'featured',\s*label:\s*'🔥'/);
  assert.match(pendingTableSource, /key:\s*'tournament',\s*label:\s*'🏆'/);
  assert.match(pendingTableSource, /buildAdminMarketsQuery\(\{\s*status:\s*filter,/);
  assert.match(pendingTableSource, /featureFilter:\s*curationFilter/);
  assert.match(pendingTableSource, /adminListPendingMarkets\(q\)/);
  assert.match(pendingTableSource, /pendingFiltersPayload\(\)/);
  assert.match(pendingTableSource, /filters\.feature = curationFilter/);
  assert.match(pendingTableSource, /adminRefreshAllPendingPricing\(pendingFiltersPayload\(\)\)/);
  assert.match(pendingTableSource, /adminApproveAllPendingMarkets\(null,\s*pendingFiltersPayload\(\)\)/);
  assert.match(pendingTableSource, /renderFilterGroup\(MARKET_CATEGORY_FILTERS,\s*categoryFilter,\s*selectCategoryFilter\)/);
  assert.match(pendingTableSource, /renderFilterGroup\(ADMIN_SPORT_FILTERS,\s*sportFilter,\s*selectSportFilter/);
  assert.match(pendingTableSource, /renderFilterGroup\(ADMIN_CRYPTO_FILTERS,\s*cryptoTypeFilter,\s*setCryptoTypeFilter/);
  assert.match(apiSource, /status instanceof URLSearchParams/);
  assert.match(apiSource, /action:\s*'refresh_pricing_all',\s*filters/);
  assert.match(apiSource, /action:\s*'approve_all',\s*note,\s*filters/);
});

test('Points pending generator button shows an in-progress state', () => {
  const pendingTableSource = sourceForFunction('PendingMarketsTable');
  assert.match(pendingTableSource, /const \[generatingNow,\s*setGeneratingNow\]/);
  assert.match(pendingTableSource, /setGeneratingNow\(true\)[\s\S]*adminRunGenerators/);
  assert.match(pendingTableSource, /setGeneratingNow\(false\)[\s\S]*setBulkBusy\(false\)/);
  assert.match(pendingTableSource, /generatingNow \? 'Generando\.\.\.' : '🔄 Generar ahora'/);
});

test('Points pending queue keeps large generated fields readable', () => {
  assert.match(source, /function formatOutcomeList\(outcomes,\s*limit = 14\)/);
  assert.match(source, /Opciones \(\{Array\.isArray\(r\.outcomes\) \? r\.outcomes\.length : 0\}\): \{formatOutcomeList\(r\.outcomes\)\}/);
  assert.match(source, /r\.sport && <> · \{r\.sport\}<\/>/);
  assert.match(source, /r\.league && <>\/\{r\.league\}<\/>/);
});

test('Points admin tabs show pending-work badges outside the active tab', () => {
  assert.match(source, /adminTaskCounts/);
  assert.match(source, /adminListTaskCounts\(\)/);
  assert.match(apiSource, /export async function adminListTaskCounts/);
  assert.match(apiSource, /adminListPendingMarkets\('pending'\)/);
  assert.match(apiSource, /\/api\/points\/admin\/markets\?status=pending/);
  assert.match(apiSource, /adminListResolutionCandidates\(\)/);
  assert.match(apiSource, /\/api\/points\/admin\/resolution-candidates\?status=pending/);
  assert.match(apiSource, /adminListSocialTasks\('pending'\)/);
  assert.match(apiSource, /total:/);
  assert.match(source, /tab !== t\.id/);
  assert.match(source, /taskCount > 0/);
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

test('Points markets filter surfaces por resolver count while inside Mercados', () => {
  assert.match(source, /pendingResolveCount=\{adminTaskCounts\.markets\}/);
  assert.match(source, /function MarketsTable\(\{ onQueueChange, pendingResolveCount = 0 \}\)/);
  assert.match(source, /s\.key === 'pending' \? pendingResolveCount : 0/);
  assert.match(source, /taskCount > 0/);
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
  assert.match(source, /Logos de opciones/);
  assert.match(source, /initialOutcomeImages/);
  assert.match(source, /updateOutcomeImage/);
  assert.match(source, /outcomeImages:\s*outcomeImagePatch/);
  assert.match(source, /Reservas Sí\/No/);
  assert.match(source, /Reserva Sí/);
  assert.match(source, /Reserva No/);
  assert.match(source, /Más reserva No = Sí más alto/);
  assert.match(source, /parallelLegs:\s*parallelLegPatches/);
  assert.match(apiSource, /adminEditMarket\(\{ marketId, question, startTime, endTime, category, outcomeImages, parallelLegs \}\)/);
  assert.match(apiSource, /outcomeImages/);
  assert.match(apiSource, /parallelLegs/);
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
  assert.match(source, /Confirmar resolución/);
  assert.match(source, /Negar/);
  assert.match(source, /En revisión/);
  assert.match(apiSource, /export async function adminReviewResolutionCandidate/);
});

test('Points admin can bulk-hide or show public markets and mark tournament overrides', () => {
  assert.match(source, /toggleHomeMarketsVisibility/);
  assert.match(source, /Ocultar mercados/);
  assert.match(source, /Mostrar mercados/);
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
  assert.match(source, /cancelMarket\(m\)/);
  assert.match(source, /onCancel=\{cancelMarket\}/);
  assert.match(source, /actionMode === 'cancel'/);
  assert.match(source, /Se devolverá el costo base/);
  assert.match(apiSource, /export async function adminReopenCanceledMarket/);
  assert.match(apiSource, /\/api\/points\/admin\/reopen-canceled-market/);
});

test('Points admin stats shows signup sheet and per-user distribution detail', () => {
  assert.match(source, /AdminUserSignupPanel/);
  assert.match(source, /Usuarios registrados/);
  assert.match(source, /row\.email/);
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
  assert.match(source, /Enviada:/);
  assert.match(source, /Revisada:/);
  assert.match(source, /Admin: @/);
});
