import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./markets.js', import.meta.url), 'utf8');
const detailSource = await readFile(new URL('./market.js', import.meta.url), 'utf8');
const pointsHome = await readFile(new URL('../../app/points/src/pages/PointsHome.jsx', import.meta.url), 'utf8');

test('points market payload keeps admin featured markets in client-side trending', () => {
  assert.match(pointsHome, /fetchMarkets\(\{\s*status:\s*'active',\s*featured:\s*'all'\s*\}\)/);
  assert.match(pointsHome, /m\.trending \|\| marketMatchesFeaturedTeam\(m,\s*featuredTeamKeys\)/);
  assert.match(source, /featured:\s*r\.featured === true/);
  assert.match(source, /trending:\s*r\.featured === true \|\| live/);
});

test('points market payload exposes featured and trending for parallel and unified markets', () => {
  const featuredMatches = source.match(/featured:\s*r\.featured === true/g) || [];
  const trendingMatches = source.match(/trending:\s*r\.featured === true \|\| live/g) || [];
  assert.equal(featuredMatches.length, 2);
  assert.equal(trendingMatches.length, 2);
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
