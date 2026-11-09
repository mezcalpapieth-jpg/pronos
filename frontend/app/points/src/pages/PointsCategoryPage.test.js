import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsCategoryPage.jsx', import.meta.url), 'utf8');

test('new markets page is a rolling 24h shelf instead of a taxonomy category', () => {
  assert.match(source, /const NEW_MARKETS_SHELF_SLUGS = new Set\(\['nuevos-mercados'\]\)/);
  assert.match(source, /const NEW_MARKET_WINDOW_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /function isRecentlyOpenedMarket\(m, now = Date\.now\(\)\)/);
  assert.match(source, /featured:\s*'all'/);
  assert.match(source, /out = out\.filter\(m => isRecentlyOpenedMarket\(m, now\)\)/);
  assert.doesNotMatch(source, /CATEGORY_TAXONOMY_ALIASES/);
});

test('category page exposes the infrastructure taxonomy route and resolved chip', () => {
  assert.match(source, /infraestructura:\s*'points\.cat\.infraestructura'/);
  assert.match(source, /RESUELTOS_CATEGORIES[\s\S]*?\{ key:\s*'infraestructura'/);
});

test('category page exposes the AI taxonomy route and resolved chip', () => {
  assert.match(source, /ai:\s*'points\.cat\.ai'/);
  assert.match(source, /RESUELTOS_CATEGORIES[\s\S]*?\{ key:\s*'ai'/);
  assert.match(source, /GEO_FILTER_EXCLUDED_CATEGORIES[\s\S]*?'ai'/);
});

test('infrastructure page renders AICM as a hub and gates child markets behind promotion', () => {
  assert.match(source, /AICM_HUB_PATH, isAicmDelayMarket/);
  assert.match(source, /function AicmInfrastructureHubCard/);
  assert.match(source, /Pulso AICM: demoras de salida/);
  assert.match(source, /out = out\.filter\(isPromotedAicmChildMarket\)/);
  assert.match(source, /m\?\.featured === true/);
  assert.match(source, /m\?\.tournamentFeatured === true/);
});

test('the infrastructure hub respects search and region filters and survives market-list failures', () => {
  assert.match(source, /normalizeSearchText\(searchQuery\)[\s\S]*?q\.split\(\/\\s\+\/\)\.every/);
  assert.match(source, /showAicmHubCard = slug === 'infraestructura'\s+&& \(geo === 'all' \|\| geo === 'mexico'\)/);
  assert.match(source, /'points\.catpage\.eyebrow', \{ n: filtered\.length \}/);
  assert.match(source, /<MarketGridSkeleton count=\{before \? 5 : 6\} before=\{before\} \/>/);
  assert.match(source, /if \(error\) \{\s+return \(\s+<>\s+\{before && <div className="markets-grid">\{before\}<\/div>\}/);
});
