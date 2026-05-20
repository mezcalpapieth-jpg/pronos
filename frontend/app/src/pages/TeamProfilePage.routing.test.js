import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mvpApp = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const pointsApp = await readFile(new URL('../../points/src/App.jsx', import.meta.url), 'utf8');
const mvpCard = await readFile(new URL('../components/MarketCard.jsx', import.meta.url), 'utf8');
const pointsCard = await readFile(new URL('../../points/src/components/PointsMarketCard.jsx', import.meta.url), 'utf8');
const mvpDetail = await readFile(new URL('./MarketDetail.jsx', import.meta.url), 'utf8');
const pointsDetail = await readFile(new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');
const teamSearch = await readFile(new URL('./TeamSearchPage.jsx', import.meta.url), 'utf8');
const teamProfile = await readFile(new URL('./TeamProfilePage.jsx', import.meta.url), 'utf8');

test('team profile route is available in points and MVP apps', () => {
  assert.match(mvpApp, /TeamProfilePage/);
  assert.match(mvpApp, /path="\/teams\/:sport\/:teamSlug"/);
  assert.match(pointsApp, /TeamProfilePage/);
  assert.match(pointsApp, /path="\/teams\/:sport\/:teamSlug"/);
});

test('team search route is available in points and MVP apps', () => {
  assert.match(mvpApp, /TeamSearchPage/);
  assert.match(mvpApp, /path="\/teams"/);
  assert.match(pointsApp, /TeamSearchPage/);
  assert.match(pointsApp, /path="\/teams"/);
});

test('market cards expose team profile links from outcome labels', () => {
  assert.match(mvpCard, /findTeamByName/);
  assert.match(mvpCard, /teamProfilePath/);
  assert.match(pointsCard, /findTeamByName/);
  assert.match(pointsCard, /teamProfilePath/);
});

test('market detail pages expose the top team profile strip', () => {
  assert.match(mvpDetail, /TeamMarketStrip/);
  assert.match(pointsDetail, /TeamMarketStrip/);
});

test('team search exposes soccer subcategory filters', () => {
  assert.match(teamSearch, /SOCCER_LEAGUE_FILTERS/);
  assert.match(teamSearch, /uefa-europa-league/);
  assert.match(teamSearch, /uefa-conference-league/);
  assert.match(teamSearch, /copa-libertadores/);
});

test('team search exposes baseball subcategory filters including LMP', () => {
  assert.match(teamSearch, /BASEBALL_LEAGUE_FILTERS/);
  assert.match(teamSearch, /lmb/);
  assert.match(teamSearch, /lmp/);
});

test('team profile defaults to active and pending rows with a todos toggle', () => {
  assert.match(teamProfile, /active-pending/);
  assert.match(teamProfile, /Todos/);
  assert.match(teamProfile, /visibleRows/);
});

test('team profile exposes a destacado star toggle', () => {
  assert.match(teamProfile, /toggleFeaturedTeam/);
  assert.match(teamProfile, /Destacado/);
  assert.match(teamProfile, /aria-label=\{featured/);
});

test('binary detail gauges use logo-based gauge rows instead of outcome text inside rings', () => {
  for (const source of [mvpDetail, pointsDetail]) {
    assert.match(source, /ProbabilityGaugeRow/);
    assert.doesNotMatch(source, /<text[\s\S]*>\{label\}<\/text>/);
  }
});
