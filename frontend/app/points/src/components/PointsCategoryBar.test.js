import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./PointsCategoryBar.jsx', import.meta.url), 'utf8');
const componentsCss = await readFile(new URL('../../../../css/components.css', import.meta.url), 'utf8');
const sectionsCss = await readFile(new URL('../../../../css/sections.css', import.meta.url), 'utf8');

test('points category bar shows Infrastructure while preserving the main category order', () => {
  const newMarketsIndex = source.indexOf("slug: 'nuevos-mercados'");
  const mexicoIndex = source.indexOf("slug: 'mexico'");
  const sportsIndex = source.indexOf("slug: 'deportes'");
  const financeIndex = source.indexOf("slug: 'finanzas'");
  const infrastructureIndex = source.indexOf("slug: 'infraestructura'");
  const politicsIndex = source.indexOf("slug: 'politica'");
  const aiIndex = source.indexOf("slug: 'ai'");
  const cryptoIndex = source.indexOf("slug: 'crypto'");
  const pendingIndex = source.indexOf("slug: 'porresolver'");

  assert.ok(newMarketsIndex >= 0, 'New markets tab should exist');
  assert.doesNotMatch(source, /slug:\s*'world-cup'/);
  assert.ok(mexicoIndex >= 0, 'Mexico & Latam tab should exist');
  assert.ok(infrastructureIndex >= 0, 'Infrastructure tab should exist');
  assert.ok(sportsIndex >= 0, 'Sports tab should exist');
  assert.ok(financeIndex >= 0, 'Finance tab should exist');
  assert.ok(pendingIndex >= 0, 'Pending tab should exist');
  assert.ok(aiIndex >= 0, 'AI tab should exist');
  assert.match(source, /points\.cat\.worldCup/);
  assert.match(source, /points\.cat\.ai/);
  assert.ok(newMarketsIndex < mexicoIndex, 'Nuevos mercados should stay before Mexico & Latam');
  assert.ok(mexicoIndex < sportsIndex, 'Mexico & Latam should appear before Deportes');
  assert.ok(financeIndex < infrastructureIndex, 'Infrastructure should appear after Finanzas');
  assert.ok(infrastructureIndex < pendingIndex, 'Infrastructure should appear before Por resolver');
  assert.ok(politicsIndex < aiIndex, 'AI should appear after Política Intl.');
  assert.ok(aiIndex < cryptoIndex, 'AI should appear before Crypto');
});

test('points categories share a pill and selected-page state with small feature indicators', () => {
  assert.match(source, /className="points-category-pill"/);
  assert.match(source, /aria-current=\{active === cat.slug \? 'page' : undefined\}/);
  assert.match(source, /cat.news && <span className="points-category-news-dot"/);
  assert.match(source, /cat.highlight && <Sparkles/);
  assert.doesNotMatch(source, /regional:|linear-gradient|RegionalCategoryLabel/);
});

test('points category bar spans the viewport and gives the last chip scroll room', () => {
  assert.match(componentsCss, /\.category-bar-inner\s*\{[\s\S]*?width:\s*100%/);
  assert.match(componentsCss, /\.category-bar-inner\s*\{[\s\S]*?max-width:\s*none/);
  assert.match(componentsCss, /\.category-bar \.market-filters\s*\{[\s\S]*?width:\s*100%/);
  assert.match(componentsCss, /scroll-padding-inline:\s*48px/);
  assert.match(componentsCss, /\.category-bar \.market-filters::after\s*\{[\s\S]*?flex:\s*0 0 48px/);
  assert.match(sectionsCss, /\.category-bar \.market-filters::after\s*\{[\s\S]*?flex-basis:\s*8px/);
});
