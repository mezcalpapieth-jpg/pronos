import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./MarketsGrid.jsx', import.meta.url), 'utf8');

test('MVP trending grid can switch to the shared market globe', () => {
  assert.match(source, /NewsMapView/);
  assert.match(source, /gridView/);
  assert.match(source, /mapMarkets/);
  assert.match(source, /fetchNews/);
  assert.match(source, /fetchPublicMapMarkets/);
  assert.match(source, /enrichNewsItemsWithGeo/);
  assert.match(source, /activeFilter === 'trending'/);
  assert.match(source, /setGridView\('map'\)/);
  assert.match(source, /setGridView\('markets'\)/);
  assert.match(source, /Mapa/);
  assert.match(source, /items=\{mapNewsItems\}/);
  assert.match(source, /markets=\{sharedMapDisplayMarkets\}/);
  assert.doesNotMatch(source, /showNewsPanel=\{false\}/);
});

test('MVP trending map uses the full active market set instead of the card subset', () => {
  const filteredIndex = source.indexOf('const filtered');
  const mapMarketsIndex = source.indexOf('const mapMarkets');
  assert.ok(filteredIndex > 0, 'filtered should exist for cards');
  assert.ok(mapMarketsIndex > filteredIndex, 'mapMarkets should be computed after filtered');

  const mapMarketsBlock = source.slice(mapMarketsIndex, source.indexOf('if (loading'));
  assert.match(mapMarketsBlock, /activeFilter === 'trending'/);
  assert.match(mapMarketsBlock, /markets/);
  assert.doesNotMatch(mapMarketsBlock, /m\.trending/);
  assert.doesNotMatch(mapMarketsBlock, /marketMatchesFeaturedTeam/);
});

test('MVP trending map loads the same shared news and market feed as the news globe', () => {
  const loaderBlock = source.slice(source.indexOf("if (gridView !== 'map'"));
  assert.match(loaderBlock, /fetchNews\(\{\s*category:\s*'featured',\s*limit:\s*120\s*\}\)/);
  assert.match(loaderBlock, /fetchPublicMapMarkets\(\{\s*limit:\s*160\s*\}\)/);
  assert.match(loaderBlock, /Promise\.allSettled/);
  assert.match(loaderBlock, /setMapNewsItems\(enrichNewsItemsWithGeo\(items\)\)/);
  assert.match(loaderBlock, /setSharedMapMarkets/);
});
