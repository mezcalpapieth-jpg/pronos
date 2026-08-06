/**
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsMarketDetail.chart-activity.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const detailSource = await readFile(new URL('./PointsMarketDetail.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../../src/lib/i18n.js', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const portfolioSource = await readFile(new URL('./PointsPortfolio.jsx', import.meta.url), 'utf8');
const buyModalSource = await readFile(new URL('../components/PointsBuyModal.jsx', import.meta.url), 'utf8');
const marketCardSource = await readFile(new URL('../components/PointsMarketCard.jsx', import.meta.url), 'utf8');

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
  assert.match(detailSource, /MarketActivityStrip/);
  assert.match(
    detailSource,
    /export default function PointsMarketDetail[\s\S]*const lang = useLang\(\);\n\s+const numberLocale = lang === 'en' \? 'en-US' : 'es-MX';/
  );
  assert.match(detailSource, /outcome: 'all'/);
  assert.match(detailSource, /activity=\{displayActivityByOutcome\?\.\[0\] \|\| \[\]\}/);
  assert.match(detailSource, /activity=\{displayActivityByOutcome\?\.\[i\] \|\| \[\]\}/);
  assert.match(detailSource, /orderBookRefresh/);
});

test('points API client exposes anonymous trade activity endpoint', () => {
  assert.match(apiSource, /export async function fetchTradeActivity/);
  assert.match(apiSource, /\/api\/points\/trade-activity\?/);
  assert.match(apiSource, /hours, outcome = 0/);
  assert.match(apiSource, /q\.set\('hours', String\(hours\)\)/);
  assert.match(apiSource, /buckets: String\(buckets\)/);
});

test('chart range copy is translated', () => {
  assert.match(i18nSource, /'points\.detail\.chartRange'/);
  assert.match(i18nSource, /'points\.detail\.range4h'/);
  assert.match(i18nSource, /'points\.detail\.range24h'/);
  assert.match(i18nSource, /'points\.detail\.range7d'/);
  assert.match(i18nSource, /'points\.detail\.range30d'/);
  assert.match(i18nSource, /'points\.detail\.activityTrades'/);
  assert.match(i18nSource, /'points\.detail\.activityVolume'/);
  assert.match(i18nSource, /'points\.detail\.activityPressure'/);
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

test('points market cards display traded volume before seed liquidity', () => {
  assert.match(marketCardSource, /const volume = market\.tradeVolume \?\? market\.volume \?\? 0/);
  assert.doesNotMatch(marketCardSource, /const volume = market\.volume \?\? market\.tradeVolume \?\? 0/);
});
