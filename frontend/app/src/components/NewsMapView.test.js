import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mapView = await readFile(new URL('./NewsMapView.jsx', import.meta.url), 'utf8');
let worldGlobe = '';
try {
  worldGlobe = await readFile(new URL('./NewsWorldGlobe.jsx', import.meta.url), 'utf8');
} catch {
  worldGlobe = '';
}
const newsPage = await readFile(new URL('../pages/NewsPage.jsx', import.meta.url), 'utf8');
const viteConfig = await readFile(new URL('../../vite.config.js', import.meta.url), 'utf8');

test('news map view renders a globe, region controls, market panel, and news panel', () => {
  assert.match(mapView, /function NewsGlobe/);
  assert.match(mapView, /function WorldLandLayer/);
  assert.match(mapView, /WORLD_LANDMASSES/);
  assert.match(mapView, /getNewsGeoRegions/);
  assert.match(mapView, /filterGeoItems/);
  assert.match(mapView, /extractMarketLocations/);
  assert.match(mapView, /summarizeGeoLocations\(items, markets\)/);
  assert.match(mapView, /markets/i);
  assert.match(mapView, /Noticias/);
  assert.match(mapView, /country-fill/);
});

test('news map lazy-loads a real WebGL globe renderer with country polygons and points', () => {
  assert.match(mapView, /React\.lazy/);
  assert.match(mapView, /NewsWorldGlobe/);
  assert.match(worldGlobe, /react-globe\.gl/);
  assert.match(worldGlobe, /world-atlas\/countries-110m\.json/);
  assert.match(worldGlobe, /pointsData/);
  assert.match(worldGlobe, /polygonsData/);
  assert.match(worldGlobe, /controls\.autoRotate = false/);
  assert.match(worldGlobe, /controls\.autoRotateSpeed = 0/);
});

test('news globe treats markets as map signals and lets countries select their markets', () => {
  assert.match(worldGlobe, /function signalLabel/);
  assert.doesNotMatch(worldGlobe, /point\.count} noticia/);
  assert.match(worldGlobe, /mercado/);
  assert.match(worldGlobe, /locationByCountryId/);
  assert.match(worldGlobe, /onPolygonClick/);
  assert.match(worldGlobe, /PY:\s*'600'/);
  assert.match(worldGlobe, /EC:\s*'218'/);
  assert.match(worldGlobe, /BO:\s*'068'/);
  assert.match(worldGlobe, /HU:\s*'348'/);
});

test('news globe loading state does not flash the static marker layer', () => {
  assert.match(mapView, /function GlobeLoadingShell/);
  assert.match(mapView, /const loadingFallback = \(/);
  assert.match(mapView, /<Suspense fallback={loadingFallback}>/);
  assert.match(mapView, /fallback={staticFallback}/);
  assert.doesNotMatch(mapView, /<Suspense fallback={fallback}>/);
});

test('news map can be reused as a market-only globe', () => {
  assert.match(mapView, /showNewsPanel = true/);
  assert.match(mapView, /showNewsPanel \?/);
  assert.match(mapView, /return visible;/);
  assert.match(mapView, /selectedCountry/);
  assert.match(mapView, /locationMatchesSelection/);
});

test('news map does not cap market locations or panel rows', () => {
  assert.doesNotMatch(mapView, /\.slice\(0,\s*28\)/);
  assert.doesNotMatch(mapView, /visible\.slice\(0,\s*8\)/);
  assert.doesNotMatch(mapView, /visibleItems\.slice\(0,\s*8\)/);
  assert.match(mapView, /maxHeight:\s*520/);
  assert.match(mapView, /overflowY:\s*'auto'/);
});

test('news map panel titles include the selected country or place', () => {
  assert.match(mapView, /selectedLocationLabel/);
  assert.match(mapView, /Mercados de \{selectedLocationLabel\}/);
  assert.match(mapView, /Noticias de \{selectedLocationLabel\}/);
});

test('news map aggregates visible globe locations by country', () => {
  assert.match(mapView, /normalizeGeoLocationToCountry/);
  assert.match(mapView, /addLocation\(normalizeGeoLocationToCountry\(location\), 'news'\)/);
  assert.match(mapView, /addLocation\(normalizeGeoLocationToCountry\(location\), 'market'\)/);
});

test('news page exposes map mode from the news experience', () => {
  assert.match(newsPage, /viewMode/);
  assert.match(newsPage, /setViewMode\('map'\)/);
  assert.match(newsPage, /useState\('all'\)/);
  assert.match(newsPage, /NewsMapView/);
  assert.match(newsPage, /Mapa/);
  assert.match(newsPage, /enrichNewsItemsWithGeo/);
  assert.match(newsPage, /viewMode === 'map' && !loading/);
  assert.doesNotMatch(newsPage, /viewMode === 'map' && !loading && !error/);
});

test('local dev serves shared CSS under the app basename', () => {
  assert.match(viteConfig, /sharedCssDevMiddleware/);
  assert.match(viteConfig, /\/mvp\/css\//);
  assert.match(viteConfig, /\/points\/css\//);
});
