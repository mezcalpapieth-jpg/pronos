import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const navSource = await readFile(new URL('./components/PointsNav.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('./lib/pointsApi.js', import.meta.url), 'utf8');
const homeSource = await readFile(new URL('./pages/PointsHome.jsx', import.meta.url), 'utf8');
const categorySource = await readFile(new URL('./pages/PointsCategoryPage.jsx', import.meta.url), 'utf8');
const earnSource = await readFile(new URL('./pages/PointsEarn.jsx', import.meta.url), 'utf8');
const portfolioSource = await readFile(new URL('./pages/PointsPortfolio.jsx', import.meta.url), 'utf8');
const supportSource = await readFile(new URL('./pages/PointsSupport.jsx', import.meta.url), 'utf8');
const buyModalSource = await readFile(new URL('./components/PointsBuyModal.jsx', import.meta.url), 'utf8');
const commentsSource = await readFile(new URL('./components/MarketComments.jsx', import.meta.url), 'utf8');
const delegationSource = await readFile(new URL('./components/PointsDelegationModal.jsx', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../../src/lib/i18n.js', import.meta.url), 'utf8');
const shareSource = await readFile(new URL('../../src/components/ShareButton.jsx', import.meta.url), 'utf8');
const newsSource = await readFile(new URL('../../src/pages/NewsPage.jsx', import.meta.url), 'utf8');
const championsSource = await readFile(new URL('../../src/lib/championsLeague.js', import.meta.url), 'utf8');
const generatedMarketsSource = await readFile(new URL('../../src/lib/generatedMarkets.js', import.meta.url), 'utf8');

function translationLine(key) {
  return i18nSource.split('\n').find(line => line.includes(`'${key}'`)) || '';
}

test('public points search uses all active markets and does not render stored market emojis', () => {
  assert.match(navSource, /fetchMarkets\(\{\s*status:\s*'active',\s*featured:\s*'all',\s*limit:\s*250\s*\}\)/);
  assert.doesNotMatch(navSource, /\{m\.icon\}/);
  assert.match(navSource, /background:\s*'var\(--orange\)'/);
});

test('portfolio nav surfaces claimable resolved winnings count', () => {
  assert.match(apiSource, /export async function fetchClaimableSummary/);
  assert.match(navSource, /fetchClaimableSummary/);
  assert.match(navSource, /claimableCount/);
  assert.match(navSource, /points-nav-alert-badge/);
  assert.match(navSource, /points-mobile-menu-badge/);
});

test('public points errors use safe user copy instead of backend details', () => {
  assert.match(apiSource, /export function publicErrorMessage/);
  assert.match(homeSource, /setError\('load_failed'\)/);
  assert.doesNotMatch(homeSource, /e\.detail|e\.message/);
  assert.doesNotMatch(categorySource, /setError\(e\.code|setError\(e\.message/);
  assert.doesNotMatch(earnSource, /Error:\s*\{state\.err\}|Error:\s*\{err\}|setErr\(e\.code|setErr\(e\.message/);
  assert.doesNotMatch(portfolioSource, /Error:\s*\{state\.err\}|e\.code \|\| e\.message/);
  assert.doesNotMatch(supportSource, /Error:\s*\{err\}|setErr\(error\.code|setErr\(error\.message/);
  assert.doesNotMatch(commentsSource, /setError\(e\.code|setError\(e\.message|e\.code \|\| e\.message/);
  assert.doesNotMatch(delegationSource, /e\.detail|e\.code \|\| e\.message/);
  assert.doesNotMatch(translationLine('points.home.loadError'), /\{err\}/);
  assert.doesNotMatch(translationLine('points.buy.quoteError'), /\{err\}/);
  assert.doesNotMatch(translationLine('points.buy.errorPrefix'), /\{code\}/);
  assert.match(buyModalSource, /publicErrorMessage/);
});

test('buy modal mirrors tournament minimum before submitting', () => {
  assert.match(buyModalSource, /TOURNAMENT_MIN_BUY_MXNP = 100/);
  assert.match(buyModalSource, /const FIRST_ENTRY_QUICK_AMOUNTS = \[100, 200, 500, 1000\]/);
  assert.match(buyModalSource, /const TOP_UP_QUICK_AMOUNTS = \[5, 10, 25, 50, 100\]/);
  assert.match(buyModalSource, /minimumEntrySatisfied = false/);
  assert.match(buyModalSource, /const requiresMinimumEntry = !minimumEntrySatisfied/);
  assert.match(buyModalSource, /requiresMinimumEntry && numAmount > 0 && numAmount < TOURNAMENT_MIN_BUY_MXNP/);
  assert.match(buyModalSource, /belowMinimum \|\| quoteState !== 'ready'/);
  assert.match(buyModalSource, /points\.buy\.minimumEntryHint/);
  assert.match(buyModalSource, /points\.buy\.topUpHint/);
  assert.match(buyModalSource, /points\.buy\.errorTournamentMin/);
  assert.match(translationLine('points.buy.minimumEntryHint'), /Mínimo \{amount\} MXNP/);
  assert.match(translationLine('points.buy.topUpHint'), /Ya cubriste este mercado/);
  assert.match(translationLine('points.buy.errorTournamentMin'), /mínimo para cubrir un mercado/);
});

test('public sharing, news links, and generated market fallbacks are text-only', () => {
  assert.doesNotMatch(shareSource, /[\u2600-\u27BF]|[\u{1F000}-\u{1FAFF}]/u);
  assert.doesNotMatch(newsSource, /📊|📈|🔗/);
  assert.match(newsSource, /\|\| 'MKT'/);
  assert.match(championsSource, /CHAMPIONS_LEAGUE_FINAL_BADGE = 'CL'/);
  assert.match(generatedMarketsSource, /icon:\s*row\.icon \|\| null/);
});
