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
