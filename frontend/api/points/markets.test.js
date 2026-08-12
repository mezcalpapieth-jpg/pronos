import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./markets.js', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('./market.js', import.meta.url), 'utf8');
const pointsHome = await readFile(new URL('../../app/points/src/pages/PointsHome.jsx', import.meta.url), 'utf8');

test('points market payload keeps admin featured and tournament markets on home', () => {
  assert.match(pointsHome, /fetchMarkets\(\{\s*status:\s*'active',\s*featured:\s*'all'\s*\}\)/);
  assert.match(pointsHome, /shouldShowOnHome\(m,\s*featuredTeamKeys\)/);
  assert.match(source, /featured:\s*r\.featured === true/);
  assert.match(source, /hiddenFromHome:\s*r\.hidden_from_home === true/);
  assert.match(source, /tournamentFeatured:\s*r\.tournament_featured === true/);
  assert.match(source, /m\.tournament_featured = true/);
});

test('points public lists hide bulk-hidden active markets outside trophy overrides', () => {
  assert.match(source, /points:markets:v6/);
  const visibilityMatches = source.match(/m\.hidden_from_home IS NOT TRUE\s+OR m\.tournament_featured = true/g) || [];
  assert.ok(visibilityMatches.length >= 2);
});

test('points market list supports trophy shelf independent of category', () => {
  assert.match(source, /function publicCategoryAlias/);
  assert.doesNotMatch(source, /raw === 'nuevos-mercados'\) return 'world-cup'/);
  assert.match(source, /publicCategoryAlias\(req\.query\.category\)/);
  assert.match(source, /featuredParam === 'tournament'/);
  assert.match(source, /tournamentOnly \? 'tournament-featured'/);
  assert.match(source, /AND m\.tournament_featured = true/);
});

test('points market payload exposes featured and trending for parallel and unified markets', () => {
  const featuredMatches = source.match(/featured:\s*r\.featured === true/g) || [];
  const trendingMatches = source.match(/trending:\s*r\.hidden_from_home !== true && \(r\.featured === true \|\| live\)/g) || [];
  const tournamentMatches = source.match(/tournamentFeatured:\s*r\.tournament_featured === true/g) || [];
  assert.equal(featuredMatches.length, 2);
  assert.equal(trendingMatches.length, 2);
  assert.equal(tournamentMatches.length, 2);
});

test('parallel payload prices resolved loser legs as zero instead of stale AMM odds', () => {
  for (const text of [source, detailSource]) {
    assert.match(text, /function binaryLegPricesFromRow/);
    assert.match(text, /String\(status \|\| ''\) === 'resolved'/);
    assert.match(text, /if \(resolvedOutcome === 0\) return \[1, 0\]/);
    assert.match(text, /if \(resolvedOutcome === 1\) return \[0, 1\]/);
    assert.match(text, /binaryLegPricesFromRow\(\{/);
  }
});

test('parallel list payload exposes leg lifecycle for card previews', () => {
  assert.match(source, /const legStatuses = legs\.map\(l => l\.status \|\| null\)/);
  assert.match(source, /const legOutcomes = legs\.map\(l => l\.outcome == null \? null : Number\(l\.outcome\)\)/);
  assert.match(source, /const activeOutcomeIndexes = legs/);
  assert.match(source, /String\(l\.status \|\| ''\)\.toLowerCase\(\) === 'active'/);
  assert.match(source, /legStatuses: legStatuses\.length === outcomes\.length \? legStatuses : null/);
  assert.match(source, /legOutcomes: legOutcomes\.length === outcomes\.length \? legOutcomes : null/);
  assert.match(source, /activeOutcomeIndexes,/);
});
