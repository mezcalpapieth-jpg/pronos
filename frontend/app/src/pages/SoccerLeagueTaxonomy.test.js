import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mvpCategory = await readFile(new URL('./CategoryPage.jsx', import.meta.url), 'utf8');
const pointsCategory = await readFile(new URL('../../points/src/pages/PointsCategoryPage.jsx', import.meta.url), 'utf8');
const mvpAdminFilters = await readFile(new URL('../lib/mvpAdminMarketFilters.js', import.meta.url), 'utf8');
const pointsAdminFilters = await readFile(new URL('../../points/src/lib/adminMarketFilters.js', import.meta.url), 'utf8');
const i18n = await readFile(new URL('../lib/i18n.js', import.meta.url), 'utf8');

test('points and MVP soccer sidebars expose the new continental leagues', () => {
  for (const source of [mvpCategory, pointsCategory]) {
    assert.match(source, /key:\s*'copa-libertadores'/);
    assert.match(source, /key:\s*'uefa-europa-league'/);
    assert.match(source, /key:\s*'uefa-conference-league'/);
    assert.match(source, /key:\s*'leagues-cup'/);
    assert.match(source, /key:\s*'international'/);
    assert.match(source, /key:\s*'club-friendlies'/);
  }
});

test('Copa Libertadores sits below Bundesliga in soccer league sidebars', () => {
  for (const source of [mvpCategory, pointsCategory, mvpAdminFilters, pointsAdminFilters]) {
    const bundesliga = source.indexOf("key: 'bundesliga'");
    const libertadores = source.indexOf("key: 'copa-libertadores'");

    assert.ok(bundesliga > -1, 'Bundesliga filter exists');
    assert.ok(libertadores > -1, 'Libertadores filter exists');
    assert.ok(libertadores > bundesliga, 'Libertadores appears after Bundesliga');
  }
});

test('admin soccer league filters and creation options expose the new continental leagues', () => {
  for (const source of [mvpAdminFilters, pointsAdminFilters]) {
    assert.match(source, /key:\s*'copa-libertadores'/);
    assert.match(source, /key:\s*'uefa-europa-league'/);
    assert.match(source, /key:\s*'uefa-conference-league'/);
    assert.match(source, /key:\s*'leagues-cup'/);
    assert.match(source, /key:\s*'international'/);
    assert.match(source, /key:\s*'club-friendlies'/);
  }
});

test('points translations include the new soccer league labels', () => {
  assert.match(i18n, /points\.league\.libertadores/);
  assert.match(i18n, /points\.league\.europa/);
  assert.match(i18n, /points\.league\.conference/);
  assert.match(i18n, /points\.league\.leaguesCup/);
  assert.match(i18n, /points\.league\.international/);
  assert.match(i18n, /points\.league\.clubFriendlies/);
});

test('points and MVP baseball sidebars expose LMP alongside LMB', () => {
  for (const source of [mvpCategory, pointsCategory, mvpAdminFilters, pointsAdminFilters]) {
    assert.match(source, /key:\s*'lmb'/);
    assert.match(source, /key:\s*'lmp'/);
  }
  assert.match(i18n, /points\.league\.lmp/);
});
