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

test('infrastructure page renders AICM as a hub and gates child markets behind promotion', () => {
  assert.match(source, /AICM_HUB_PATH, isAicmDelayMarket/);
  assert.match(source, /function AicmInfrastructureHubCard/);
  assert.match(source, /Pulso AICM: demoras de salida/);
  assert.match(source, /out = out\.filter\(isPromotedAicmChildMarket\)/);
  assert.match(source, /m\?\.featured === true/);
  assert.match(source, /m\?\.tournamentFeatured === true/);
});
