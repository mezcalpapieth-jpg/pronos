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
  }
});

test('admin soccer league filters and creation options expose the new continental leagues', () => {
  for (const source of [mvpAdminFilters, pointsAdminFilters]) {
    assert.match(source, /key:\s*'copa-libertadores'/);
    assert.match(source, /key:\s*'uefa-europa-league'/);
    assert.match(source, /key:\s*'uefa-conference-league'/);
  }
});

test('points translations include the new soccer league labels', () => {
  assert.match(i18n, /points\.league\.libertadores/);
  assert.match(i18n, /points\.league\.europa/);
  assert.match(i18n, /points\.league\.conference/);
});
