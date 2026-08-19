/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.chart-activity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const portfolioSource = await readFile(new URL('./PointsPortfolio.jsx', import.meta.url), 'utf8');
const buyModalSource = await readFile(new URL('../components/PointsBuyModal.jsx', import.meta.url), 'utf8');
const marketCardSource = await readFile(new URL('../components/PointsMarketCard.jsx', import.meta.url), 'utf8');
const multiSource = await readFile(new URL('../../../src/components/MultiSparkline.jsx', import.meta.url), 'utf8');
const tradeTapeSource = await readFile(new URL('../../../../api/points/trade-tape.js', import.meta.url), 'utf8');

test('points market detail overlays real activity and range controls on the chart', () => {
  assert.match(detailSource, /fetchTradeActivity/);
  assert.match(detailSource, /DETAIL_CHART_RANGES/);
  assert.match(detailSource, /points\.detail\.range4h/);
  assert.match(detailSource, /points\.detail\.range24h/);
  assert.match(detailSource, /points\.detail\.range7d/);
  assert.match(detailSource, /points\.detail\.range30d/);
  assert.match(detailSource, /hours: 4/);
  assert.match(detailSource, /chartRangeTouchedRef/);
  assert.match(detailSource, /market\.status === 'resolved' \? '30' : '1'/);
  assert.match(detailSource, /activityByOutcome/);
  assert.match(detailSource, /summarizeActivity/);
  assert.match(detailSource, /unixSecondsFromDateLike\(market\.lastTradeAt\) \|\| activitySummary\.lastAt/);
  assert.match(detailSource, /MarketActivityStrip/);
  assert.match(detailSource, /lastTradeAt=\{latestTradeAt\}/);
  assert.match(
    detailSource,
    /export default function PointsMarketDetail[\s\S]*const lang = useLang\(\);\n\s+const numberLocale = lang === 'en' \? 'en-US' : 'es-MX';/
  );
  assert.match(detailSource, /outcome: 'all'/);
  assert.match(detailSource, /activity=\{displayActivityByOutcome\?\.\[0\] \|\| \[\]\}/);
  // Multi-outcome markets pass every outcome's activity to one chart,
  // which merges them into a single volume band.
  assert.match(detailSource, /activity=\{chartIndices\.map\(i => displayActivityByOutcome\?\.\[i\] \|\| \[\]\)\}/);
  assert.match(detailSource, /function chartActivityScore\(activity\)/);
  assert.match(detailSource, /displayActivityByOutcome = \[\]/);
  assert.match(detailSource, /chartActivityScore\(displayActivityByOutcome\?\.\[i\]\) > 0/);
  assert.match(detailSource, /for \(const i of activeMovers\.slice\(0, 2\)\) add\(i\)/);
  assert.match(detailSource, /displayActivityByOutcome,/);
  assert.match(detailSource, /orderBookRefresh/);
});

test('multi-outcome markets draw every line on one shared axis', () => {
  // Stacked one-row-per-outcome sparklines gave each line its own
  // baseline, so lines at 20% and 95% looked identical.
  assert.match(detailSource, /import MultiSparkline from '@app\/components\/MultiSparkline\.jsx'/);
  assert.match(detailSource, /<MultiSparkline/);
  assert.doesNotMatch(detailSource, /domainMin=\{sharedDomain\?\.min\}/);
  assert.doesNotMatch(detailSource, /carriesAxis/);

  assert.match(multiSource, /export default function MultiSparkline/);
  assert.match(multiSource, /priceDomain/);
  // One domain and one time axis shared by every series.
  assert.match(multiSource, /const domain = useMemo/);
  assert.match(multiSource, /const timeBounds = useMemo/);
  // Step-after holds, same as the single-line chart.
  assert.match(multiSource, /L\$\{coords\[i\]\.x\.toFixed\(2\)\},\$\{coords\[i - 1\]\.y\.toFixed\(2\)\}/);
  // Legend replaces per-row labels and doubles as the hover readout.
  assert.match(multiSource, /hoverReadouts/);
  assert.doesNotMatch(multiSource, /Math\.random/);
});

test('active charts append the live executable price as their tail', () => {
  assert.match(detailSource, /const livePctFor = \(outcomeIdx, leg = null\) => \{/);
  assert.match(detailSource, /if \(market\.status !== 'active'\) return null/);
  assert.match(detailSource, /market\.ammMode === 'parallel' && leg\s+\? leg\?\.prices\?\.\[0\]/);
  assert.match(detailSource, /: market\.prices\?\.\[outcomeIdx\]/);
  assert.match(detailSource, /const p = livePctFor\(outcomeIdx, leg\)/);
  assert.match(detailSource, /Math\.floor\(Date\.now\(\) \/ 1000\)/);
});

test('outcome logos fall back to initials when a supplied image fails', () => {
  for (const text of [detailSource, marketCardSource]) {
    assert.match(text, /function outcomeInitials\(label\)/);
    assert.match(text, /const \[failed, setFailed\] = useState\(false\)/);
    assert.match(text, /pointsPublicAssetSrc\(src\)/);
    assert.match(text, /onError=\{\(\) => setFailed\(true\)\}/);
    assert.match(text, /outcomeInitials\(label\)/);
    assert.doesNotMatch(text, /style\.display = 'none'/);
  }
});

test('points API client exposes anonymous trade activity endpoint', () => {
  assert.match(apiSource, /export async function fetchTradeActivity/);
  assert.match(apiSource, /export async function fetchTradeTape/);
  assert.match(apiSource, /\/api\/points\/trade-activity\?/);
  assert.match(apiSource, /\/api\/points\/trade-tape\?/);
  assert.match(apiSource, /hours, outcome = 0/);
  assert.match(apiSource, /q\.set\('hours', String\(hours\)\)/);
  assert.match(apiSource, /buckets: String\(buckets\)/);
  assert.match(apiSource, /details = false/);
  assert.match(apiSource, /if \(details\) q\.set\('details', '1'\)/);
});

test('public trade tape exposes named movements but hides maker and AMM routing', () => {
  assert.match(tradeTapeSource, /GET \/api\/points\/trade-tape/);
  assert.match(tradeTapeSource, /function aggregateRows/);
  assert.match(tradeTapeSource, /function tradeGroupKey/);
  assert.match(tradeTapeSource, /EXECUTION_BUCKET_MS/);
  assert.match(tradeTapeSource, /priceBefore/);
  assert.match(tradeTapeSource, /priceAfter/);
  assert.match(tradeTapeSource, /priceMin/);
  assert.match(tradeTapeSource, /priceMax/);
  assert.match(tradeTapeSource, /fillCount/);
  assert.match(tradeTapeSource, /t\.username/);
  assert.match(tradeTapeSource, /t\.collateral/);
  assert.match(tradeTapeSource, /t\.reserves_before/);
  assert.match(tradeTapeSource, /t\.reserves_after/);
  assert.match(tradeTapeSource, /outcomeLabelFor/);
  assert.match(tradeTapeSource, /outcomeSideLabelFor/);
  assert.match(tradeTapeSource, /outcomeDisplayLabelFor/);
  assert.match(tradeTapeSource, /\$\{label\} · \$\{sideLabel\}/);
  assert.match(tradeTapeSource, /username <> \$\{PRONOS_TREASURY_USERNAME\}/);
  assert.match(tradeTapeSource, /import \{ readSession \} from '\.\.\/_lib\/session\.js'/);
  assert.match(tradeTapeSource, /import \{ isAdminUsername \} from '\.\.\/_lib\/points-admin\.js'/);
  assert.match(tradeTapeSource, /const wantsDetails = req\.query\.details === '1' \|\| req\.query\.details === 'true'/);
  assert.match(tradeTapeSource, /includeDetails = isAdminUsername\(session\?\.username\)/);
  assert.match(tradeTapeSource, /setCacheHeaders\(res, includeDetails \? \{/);
  assert.match(tradeTapeSource, /cachedJson\(cacheKey, includeDetails \? 0 : 2_000/);
  assert.match(tradeTapeSource, /fills: includeDetails \? \[\] : null/);
  assert.match(tradeTapeSource, /payload\.fills = \[\.\.\.group\.fills\]/);
  assert.doesNotMatch(tradeTapeSource, /source\s*:/);
  assert.doesNotMatch(tradeTapeSource, /executionSource|orderBookSource|makerSource/);
});

test('market detail can request admin-only trade fill details without exposing them in the carousel', () => {
  assert.match(appSource, /<PointsMarketDetail onOpenLogin=\{onOpenLogin\} isAdmin=\{isAdmin\} \/>/);
  assert.match(detailSource, /export default function PointsMarketDetail\(\{ onOpenLogin, isAdmin = false \}\)/);
  assert.match(detailSource, /fetchTradeTape\(tradeTapeIds, \{ hours: 24 \* 30, limit: 80, details: isAdmin \}\)/);
  assert.match(detailSource, /showTradeDetails=\{isAdmin\}/);
  assert.match(detailSource, /orderBookRefresh, isAdmin/);
});

test('chart range copy is translated', () => {
  assert.match(i18nSource, /'points\.detail\.chartRange'/);
  assert.match(i18nSource, /'points\.detail\.range4h'/);
  assert.match(i18nSource, /'points\.detail\.range24h'/);
  assert.match(i18nSource, /'points\.detail\.range7d'/);
  assert.match(i18nSource, /'points\.detail\.range30d'/);
  assert.match(i18nSource, /'points\.detail\.activityTrades'/);
  assert.match(i18nSource, /'points\.detail\.activityVolume'/);
  assert.match(i18nSource, /'points\.detail\.activityVolumeRange'/);
  assert.match(i18nSource, /'points\.detail\.activityPressure'/);
  assert.match(i18nSource, /'points\.activity\.detailsShow'/);
  assert.match(i18nSource, /'points\.activity\.detailsHide'/);
  assert.doesNotMatch(detailSource, /activityOpsShort/);
});

test('points surfaces refresh live after trades, claims, and remote market movement', () => {
  assert.match(detailSource, /function marketLiveSignature/);
  assert.match(detailSource, /prices\.map\(p => signatureNumber\(p\)\)/);
  assert.match(detailSource, /reserves\.map\(r => signatureNumber\(r, 2\)\)/);
  assert.match(detailSource, /window\.setInterval\(\(\) => \{/);
  assert.match(detailSource, /15_000/);
  assert.match(detailSource, /setOrderBookRefresh\(v => v \+ 1\)/);
  assert.match(detailSource, /setPositionRefreshNonce\(v => v \+ 1\)/);
  assert.match(detailSource, /emitPointsRefresh\(\{ source: didResolve \? 'resolved' : 'market_poll'/);
  assert.match(detailSource, /<TopHolders marketId=\{market\.id\} refreshKey=\{orderBookRefresh\}/);

  assert.match(navSource, /onPointsRefresh/);
  assert.match(navSource, /window\.setInterval\(loadClaimableCount, 20000\)/);
  assert.match(navSource, /window\.setInterval\(refreshBalance, 30000\)/);

  assert.match(portfolioSource, /onPointsRefresh\(refreshPortfolio\)/);
  assert.match(portfolioSource, /window\.setInterval\(refreshPortfolio, tab === 'activo' \? 25000 : 45000\)/);
  assert.match(portfolioSource, /emitPointsRefresh\(\{ source: 'redeem'/);

  assert.match(buyModalSource, /emitPointsRefresh\(\{ source: 'buy'/);
});

test('points market cards display seed liquidity plus traded volume', () => {
  assert.match(marketCardSource, /function displayedMarketVolume\(market\)/);
  assert.match(marketCardSource, /const seed = Number\(market\?\.volume \|\| 0\)/);
  assert.match(marketCardSource, /const traded = Number\(market\?\.tradeVolume \|\| 0\)/);
  assert.match(marketCardSource, /return seed \+ traded/);
});

test('parallel market cards hide eliminated outcomes from the preview list', () => {
  assert.match(marketCardSource, /const legStatuses = market\.ammMode === 'parallel'/);
  assert.match(marketCardSource, /const legOutcomes = market\.ammMode === 'parallel'/);
  assert.match(marketCardSource, /const visibleOutcomeRows = \(\(\) => \{/);
  assert.match(marketCardSource, /String\(row\.legStatus \|\| ''\)\.toLowerCase\(\) === 'active'/);
  assert.match(marketCardSource, /Number\(row\.price\) > 0/);
  assert.match(marketCardSource, /visibleOutcomeRows\.map\(\(row\) => \{/);
  assert.match(marketCardSource, /setDrawerIndex\(i\)/);
});
