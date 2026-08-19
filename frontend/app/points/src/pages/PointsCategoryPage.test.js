import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsCategoryPage.jsx', import.meta.url), 'utf8');

test('new markets page is a trophy shelf instead of a taxonomy category', () => {
  assert.match(source, /const TOURNAMENT_SHELF_SLUGS = new Set\(\['nuevos-mercados'\]\)/);
  assert.match(source, /featured:\s*isTournamentShelf \? 'tournament' : 'all'/);
  assert.match(source, /out = out\.filter\(m => m\.tournamentFeatured === true\)/);
  assert.doesNotMatch(source, /CATEGORY_TAXONOMY_ALIASES/);
});

test('category page supports the infrastructure taxonomy bucket', () => {
  assert.match(source, /infraestructura:\s*'points\.cat\.infraestructura'/);
  assert.match(source, /\{ key:\s*'infraestructura',\s*tKey:\s*'points\.cat\.infraestructura'/);
});

test('infrastructure page renders AICM as a hub and gates child markets behind promotion', () => {
  assert.match(source, /const AICM_HUB_PATH = '\/c\/infraestructura\/aicm'/);
  assert.match(source, /function AicmInfrastructureHubCard/);
  assert.match(source, /Pulso AICM: demoras de salida/);
  assert.match(source, /out = out\.filter\(isPromotedAicmChildMarket\)/);
  assert.match(source, /m\?\.featured === true/);
  assert.match(source, /m\?\.tournamentFeatured === true/);
});
