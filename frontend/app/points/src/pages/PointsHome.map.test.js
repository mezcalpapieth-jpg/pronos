import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsHome.jsx', import.meta.url), 'utf8');
const tournament = await readFile(new URL('./PointsTournament.jsx', import.meta.url), 'utf8');

test('points home trending can switch from market cards to a market globe', () => {
  assert.match(source, /NewsMapView/);
  assert.match(source, /trendingView/);
  assert.match(source, /mapMarkets/);
  assert.match(source, /fetchNews/);
  assert.match(source, /fetchPublicMapMarkets/);
  assert.match(source, /enrichNewsItemsWithGeo/);
  assert.match(source, /setTrendingView\('map'\)/);
  assert.match(source, /setTrendingView\('markets'\)/);
  assert.match(source, /Mapa/);
  assert.match(source, /items=\{mapNewsItems\}/);
  assert.match(source, /markets=\{homeMapMarkets\}/);
  assert.doesNotMatch(source, /showNewsPanel=\{false\}/);
});

test('points home keeps cards curated but feeds all active markets to the map', () => {
  const mapMarketsIndex = source.indexOf('const mapMarkets');
  const filteredIndex = source.indexOf('const filtered');
  assert.ok(mapMarketsIndex > 0, 'mapMarkets should be computed separately');
  assert.ok(filteredIndex > mapMarketsIndex, 'trending filter should derive after mapMarkets');

  const mapMarketsBlock = source.slice(mapMarketsIndex, filteredIndex);
  assert.doesNotMatch(mapMarketsBlock, /m\.trending/);
  assert.doesNotMatch(mapMarketsBlock, /marketMatchesFeaturedTeam/);

  const filteredBlock = source.slice(filteredIndex, source.indexOf('const homeMapMarkets'));
  assert.match(filteredBlock, /m\.trending/);
  assert.match(filteredBlock, /marketMatchesFeaturedTeam/);
});

test('points home map loads the same shared news and market feed as the news globe', () => {
  const sharedLoaderIndex = source.indexOf('fetchPublicMapMarkets');
  assert.ok(sharedLoaderIndex > 0, 'points home should import the shared public map loader');

  const loaderBlock = source.slice(source.indexOf("if (trendingView !== 'map'"));
  assert.match(loaderBlock, /fetchNews\(\{\s*category:\s*'featured',\s*limit:\s*120\s*\}\)/);
  assert.match(loaderBlock, /fetchPublicMapMarkets\(\{\s*limit:\s*160\s*\}\)/);
  assert.match(loaderBlock, /Promise\.allSettled/);
  assert.match(loaderBlock, /setMapNewsItems\(enrichNewsItemsWithGeo\(items\)\)/);
  assert.match(loaderBlock, /setSharedMapMarkets/);
});

test('the prize ladder lives on the tournament page, not home', () => {
  // Home used to carry the prize card in its hero. That hero is gone: the
  // pitch moved to PointsIntroModal and the prize ladder to /torneo, which
  // already renders it next to the live leaderboard. Home must not grow a
  // second copy that can drift out of sync with the tournament page.
  assert.doesNotMatch(source, /points\.hero\./);
  assert.doesNotMatch(source, /\$5,000 MXN/);
  assert.doesNotMatch(source, /section id="hero"/);
});

test('paused prize cycles still show the full prize ladder on the tournament page', () => {
  const firstPrizeIndex = tournament.indexOf('$3,500 MXN');
  const secondPrizeIndex = tournament.indexOf('$2,500 MXN');
  const thirdPrizeIndex = tournament.indexOf('$1,800 MXN');

  assert.ok(firstPrizeIndex > 0, 'the tournament page should render the prize ladder');
  assert.ok(secondPrizeIndex > firstPrizeIndex, 'second place follows first');
  assert.ok(thirdPrizeIndex > secondPrizeIndex, 'third place follows second');
  // The ladder is rendered from a plain list, not gated behind cycle state,
  // so pausing cycles cannot hide it.
  assert.match(tournament, /rank: '1', amount: 3500, prize: '\$3,500 MXN'/);
  assert.match(tournament, /fetchLeaderboard/);
});
