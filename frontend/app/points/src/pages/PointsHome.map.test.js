import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsHome.jsx', import.meta.url), 'utf8');

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

  const filteredBlock = source.slice(filteredIndex, source.indexOf('// Derived stats'));
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

test('points home paused prize cycles keep the prize ladder visible', () => {
  assert.doesNotMatch(source, /points\.hero\.cyclesPausedTitle/);

  const comingSoonIndex = source.indexOf('points.hero.comingSoon');
  const top10Index = source.indexOf('points.hero.top10Text');
  const firstPrizeIndex = source.indexOf('$5,000 MXN');
  const pausedBodyIndex = source.indexOf('points.hero.cyclesPausedBody', firstPrizeIndex);
  const footerIndex = source.indexOf('points.hero.rankBy', pausedBodyIndex);

  assert.ok(comingSoonIndex > 0, 'paused cycles should still label the topbar as coming soon');
  assert.ok(top10Index > comingSoonIndex, 'the card title should remain the top 10 leaderboard copy');
  assert.ok(firstPrizeIndex > top10Index, 'the visible prize ladder should remain under the title');
  assert.ok(pausedBodyIndex > firstPrizeIndex, 'the paused explanation should be additive below prizes');
  assert.ok(footerIndex > pausedBodyIndex, 'the cash-prize footer should stay at the bottom of the card');
});
