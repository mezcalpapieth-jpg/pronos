import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const mvpApp = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const mvpCategory = await readFile(new URL('./CategoryPage.jsx', import.meta.url), 'utf8');
const mvpMarketCard = await readFile(new URL('../components/MarketCard.jsx', import.meta.url), 'utf8');
const pointsMarketCard = await readFile(new URL('../../points/src/components/PointsMarketCard.jsx', import.meta.url), 'utf8');
const mvpMarketDetail = await readFile(new URL('./MarketDetail.jsx', import.meta.url), 'utf8');
const pointsApp = await readFile(new URL('../../points/src/App.jsx', import.meta.url), 'utf8');
const pointsCategory = await readFile(new URL('../../points/src/pages/PointsCategoryPage.jsx', import.meta.url), 'utf8');
const pointsMarketDetail = await readFile(new URL('../../points/src/pages/PointsMarketDetail.jsx', import.meta.url), 'utf8');
const rootVercel = JSON.parse(await readFile(new URL('../../../../vercel.json', import.meta.url), 'utf8'));
const frontendVercel = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));

test('old Champions League hub URLs redirect to the current market list on both apps', () => {
  assert.match(pointsApp, /Navigate/);
  assert.match(pointsApp, /path="\/c\/deportes\/uefa-champions-league"/);
  assert.match(pointsApp, /to="\/c\/deportes\?sport=soccer&league=uefa-cl"/);
  assert.ok(
    pointsApp.indexOf('path="/c/deportes/uefa-champions-league"') < pointsApp.indexOf('path="/c/:slug"'),
    'points redirect should beat the generic category route',
  );

  assert.match(mvpApp, /Navigate/);
  assert.match(mvpApp, /path="\/c\/deportes\/uefa-champions-league"/);
  assert.match(mvpApp, /to="\/c\/deportes\?sport=soccer&league=uefa-cl"/);
  assert.ok(
    mvpApp.indexOf('path="/c/deportes/uefa-champions-league"') < mvpApp.indexOf('path="/c/:slug"'),
    'MVP redirect should beat the generic category route',
  );
});

test('UEFA Champions League league chips use the normal league filter', () => {
  assert.match(pointsCategory, /key:\s*'uefa-cl'[\s\S]*?tKey:\s*'points\.league\.uefaCl'/);
  assert.match(pointsCategory, /onClick=\{\(\) => setLeague\(l\.key\)\}/);
  assert.doesNotMatch(pointsCategory, /navigate\(l\.hubPath\)/);
  assert.doesNotMatch(pointsCategory, /hubPath:\s*'\/c\/deportes\/uefa-champions-league'/);

  assert.match(mvpCategory, /key:\s*'uefa-cl'[\s\S]*?label:\s*'UEFA Champions League'/);
  assert.match(mvpCategory, /onClick=\{\(\) => setLeague\(l\.key\)\}/);
  assert.doesNotMatch(mvpCategory, /navigate\(l\.hubPath\)/);
  assert.doesNotMatch(mvpCategory, /hubPath:\s*'\/c\/deportes\/uefa-champions-league'/);
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

test('Champions League final detail presentation removes draw outcomes on both surfaces', () => {
  for (const source of [pointsMarketDetail, mvpMarketDetail]) {
    assert.match(source, /finalMarketOptions/);
    assert.match(source, /displayOutcomeIndices/);
  }
});

test('Champions League final market cards open market details like normal cards', () => {
  for (const source of [pointsMarketCard, mvpMarketCard]) {
    assert.doesNotMatch(source, /isChampionsLeagueFinalWinnerMarket/);
    assert.doesNotMatch(source, /CHAMPIONS_LEAGUE_HUB_PATH/);
    assert.doesNotMatch(source, /CHAMPIONS_LEAGUE_FINAL_BADGE/);
  }
});
