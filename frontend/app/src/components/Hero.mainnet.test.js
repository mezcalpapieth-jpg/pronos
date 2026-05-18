import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const heroSource = await readFile(new URL('./Hero.jsx', import.meta.url), 'utf8');
const i18nSource = await readFile(new URL('../lib/i18n.js', import.meta.url), 'utf8');

test('MVP hero keeps demo markets behind an explicit non-production flag', () => {
  assert.match(heroSource, /ENABLE_DEMO_MARKETS/);
  assert.match(heroSource, /VITE_MVP_DEMO_MARKETS/);
  assert.match(heroSource, /useState\(\(\) => ENABLE_DEMO_MARKETS \? DEMO_MARKETS : \[\]\)/);
  assert.match(heroSource, /if \(!ENABLE_DEMO_MARKETS\) return;/);
});

test('MVP home copy does not advertise Polymarket or local fallback markets', () => {
  assert.doesNotMatch(i18nSource, /Polymarket \+ mercados locales/);
  assert.doesNotMatch(i18nSource, /Polymarket \+ local markets/);
  assert.match(i18nSource, /mercados on-chain/);
  assert.match(i18nSource, /on-chain markets/);
});
