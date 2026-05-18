import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./CategoryBar.jsx', import.meta.url), 'utf8');

test('MVP category bar mirrors points Mexico and Latam placement', () => {
  const worldCupIndex = source.indexOf("slug: 'world-cup'");
  const mexicoIndex = source.indexOf("slug: 'mexico'");
  const sportsIndex = source.indexOf("slug: 'deportes'");

  assert.ok(worldCupIndex >= 0, 'World Cup tab should exist');
  assert.ok(mexicoIndex >= 0, 'Mexico & Latam tab should exist');
  assert.ok(sportsIndex >= 0, 'Sports tab should exist');
  assert.ok(worldCupIndex < mexicoIndex, 'Mexico & Latam should stay calmer than World Cup');
  assert.ok(mexicoIndex < sportsIndex, 'Mexico & Latam should appear before Deportes');
});

test('MVP category bar gives Mexico and Latam a subtle regional treatment', () => {
  assert.match(source, /slug:\s*'mexico'[\s\S]*?label:\s*'Mexico & Latam'[\s\S]*?regional:\s*true/);
  assert.match(source, /if \(cat\.regional\)/);
  assert.match(source, /aria-label=\{`\$\{cat\.label\} destacado`\}/);
  const regionalBlock = source.slice(
    source.indexOf('if (cat.regional)'),
    source.indexOf('if (cat.news)'),
  );
  assert.doesNotMatch(regionalBlock, /pronos-news-pulse/);
});
