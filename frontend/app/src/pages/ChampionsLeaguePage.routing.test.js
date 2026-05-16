import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const mvpApp = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const mvpCategory = await readFile(new URL('./CategoryPage.jsx', import.meta.url), 'utf8');
const championsLeagueHub = await readFile(new URL('../components/ChampionsLeagueHub.jsx', import.meta.url), 'utf8');
const mvpMarketDetail = await readFile(new URL('./MarketDetail.jsx', import.meta.url), 'utf8');
const pointsApp = await readFile(new URL('../../points/src/App.jsx', import.meta.url), 'utf8');
const pointsCategory = await readFile(new URL('../../points/src/pages/PointsCategoryPage.jsx', import.meta.url), 'utf8');
const pointsMarketDetail = await readFile(new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');
const rootVercel = JSON.parse(await readFile(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
const frontendVercel = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));

test('Champions League hub routes before generic category pages on both apps', () => {
  assert.match(pointsApp, /PointsChampionsLeaguePage/);
  assert.match(pointsApp, /path="\/c\/deportes\/uefa-champions-league"/);
  assert.ok(
    pointsApp.indexOf('path="/c/deportes/uefa-champions-league"') < pointsApp.indexOf('path="/c/:slug"'),
    'points route should beat the generic category route',
  );

  assert.match(mvpApp, /ChampionsLeaguePage/);
  assert.match(mvpApp, /path="\/c\/deportes\/uefa-champions-league"/);
  assert.ok(
    mvpApp.indexOf('path="/c/deportes/uefa-champions-league"') < mvpApp.indexOf('path="/c/:slug"'),
    'MVP route should beat the generic category route',
  );
});

test('UEFA Champions League league chips navigate to the hub', () => {
  assert.match(pointsCategory, /key:\s*'uefa-cl'[\s\S]*?hubPath:\s*'\/c\/deportes\/uefa-champions-league'/);
  assert.match(pointsCategory, /navigate\(l\.hubPath\)/);
  assert.match(mvpCategory, /key:\s*'uefa-cl'[\s\S]*?hubPath:\s*'\/c\/deportes\/uefa-champions-league'/);
  assert.match(mvpCategory, /navigate\(l\.hubPath\)/);
});

test('Vercel rewrites preserve hard refreshes on the nested Champions League hub', () => {
  for (const config of [rootVercel, frontendVercel]) {
    const rewrites = config.rewrites || [];
    assert.ok(
      rewrites.some(r => r.source === '/points/c/deportes/uefa-champions-league' && r.destination === '/points/'),
      'points Champions League route should rewrite to points SPA',
    );
    assert.ok(
      rewrites.some(r => r.source === '/mvp/c/deportes/uefa-champions-league' && r.destination === '/mvp/'),
      'MVP Champions League route should rewrite to MVP SPA',
    );
  }
});

test('Champions League hub public copy hides mock framing and links the real final market', () => {
  assert.doesNotMatch(championsLeagueHub, /Mock de archivo|Mercados cerrados del torneo/);
  assert.match(championsLeagueHub, /Mercados del torneo/);
  assert.match(championsLeagueHub, /finalMarket/);
  assert.match(championsLeagueHub, /marketHref/);
});

test('Champions League final detail presentation removes draw outcomes on both surfaces', () => {
  for (const source of [pointsMarketDetail, mvpMarketDetail]) {
    assert.match(source, /finalMarketOptions/);
    assert.match(source, /displayOutcomeIndices/);
  }
});
