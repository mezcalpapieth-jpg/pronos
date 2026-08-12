import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./PointsCategoryBar.jsx', import.meta.url), 'utf8');

test('points category bar puts new markets before Mexico and Latam, then sports', () => {
  const newMarketsIndex = source.indexOf("slug: 'world-cup'");
  const mexicoIndex = source.indexOf("slug: 'mexico'");
  const sportsIndex = source.indexOf("slug: 'deportes'");

  assert.ok(newMarketsIndex >= 0, 'New markets tab should exist');
  assert.ok(mexicoIndex >= 0, 'Mexico & Latam tab should exist');
  assert.ok(sportsIndex >= 0, 'Sports tab should exist');
  assert.match(source, /points\.cat\.worldCup/);
  assert.ok(newMarketsIndex < mexicoIndex, 'Nuevos mercados should stay before Mexico & Latam');
  assert.ok(mexicoIndex < sportsIndex, 'Mexico & Latam should appear before Deportes');
});

test('points category bar gives Mexico and Latam a subtle text-only treatment', () => {
  assert.match(source, /slug:\s*'mexico'[\s\S]*?regional:\s*true/);
  assert.match(source, /if \(cat\.regional\)/);
  assert.match(source, /aria-label=\{`\$\{t\(cat\.tKey\)\} destacado`\}/);
  const regionalBlock = source.slice(
    source.indexOf('if (cat.regional)'),
    source.indexOf('if (cat.news)'),
  );
  assert.doesNotMatch(regionalBlock, /pronos-news-pulse/);
  assert.doesNotMatch(regionalBlock, /✦/);
});
