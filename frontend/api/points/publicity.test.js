import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helper = await readFile(new URL('../_lib/publicity.js', import.meta.url), 'utf8');
const redirect = await readFile(new URL('./publicity/redirect.js', import.meta.url), 'utf8');
const landing = await readFile(new URL('./publicity/landing.js', import.meta.url), 'utf8');
const conversion = await readFile(new URL('./publicity/conversion.js', import.meta.url), 'utf8');
const stats = await readFile(new URL('./admin/stats.js', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(await readFile(new URL('../../../vercel.json', import.meta.url), 'utf8'));

function hasRewrite(source, destination) {
  return Array.isArray(vercelConfig.rewrites)
    && vercelConfig.rewrites.some(rule => rule.source === source && rule.destination === destination);
}

test('publicity helper limits attribution to Instagram, TikTok, and X', () => {
  assert.match(helper, /source: 'instagram'/);
  assert.match(helper, /source: 'tiktok'/);
  assert.match(helper, /source: 'x'/);
  assert.match(helper, /path: '\/i'/);
  assert.match(helper, /path: '\/t'/);
  assert.match(helper, /path: '\/x'/);
  assert.match(helper, /raw === 'a'/);
  assert.match(helper, /raw === 'b'/);
  assert.match(helper, /raw === 'c'/);
  assert.match(helper, /pronos_publicity_id/);
  assert.match(helper, /pronos_publicity_source/);
  assert.match(helper, /hashPublicityVisitorKey/);
});

test('social bio redirects record aggregate visits and set attribution cookies', () => {
  assert.match(redirect, /points_publicity_visitors/);
  assert.match(redirect, /points_publicity_daily/);
  assert.match(redirect, /setPublicityCookies/);
  assert.match(redirect, /utm_source/);
  assert.match(redirect, /\/points\//);
  assert.match(redirect, /Cache-Control/);
});

test('pathless social bio landings record visits before cleaning the browser URL', () => {
  assert.match(landing, /points_publicity_visitors/);
  assert.match(landing, /points_publicity_daily/);
  assert.match(landing, /setPublicityCookies/);
  assert.match(landing, /normalizePublicitySource\(req\.body\?\.source\)/);
  assert.match(landing, /visits = points_publicity_daily\.visits \+ 1/);
});

test('publicity conversion is authenticated and one-time per username', () => {
  assert.match(conversion, /readSession/);
  assert.match(conversion, /points_publicity_attributions/);
  assert.match(conversion, /ON CONFLICT \(username\) DO NOTHING/);
  assert.match(conversion, /points_publicity_daily/);
  assert.match(conversion, /conversions = points_publicity_daily\.conversions \+ 1/);
});

test('admin stats exposes publicity source metrics', () => {
  assert.match(stats, /points_publicity_daily/);
  assert.match(stats, /PUBLICITY_SOURCES/);
  assert.match(stats, /monthConversionRate/);
  assert.match(stats, /publicity:\s*\{/);
});

test('root social bio paths rewrite to the publicity redirect API', () => {
  const expected = [
    ['/i', 'instagram'],
    ['/i/', 'instagram'],
    ['/t', 'tiktok'],
    ['/t/', 'tiktok'],
    ['/x', 'x'],
    ['/x/', 'x'],
    ['/instagram', 'instagram'],
    ['/instagram/', 'instagram'],
    ['/tiktok', 'tiktok'],
    ['/tiktok/', 'tiktok'],
    ['/twitter', 'x'],
    ['/twitter/', 'x'],
    ['/points/i', 'instagram'],
    ['/points/i/', 'instagram'],
    ['/points/t', 'tiktok'],
    ['/points/t/', 'tiktok'],
    ['/points/x', 'x'],
    ['/points/x/', 'x'],
    ['/points/instagram', 'instagram'],
    ['/points/instagram/', 'instagram'],
    ['/points/tiktok', 'tiktok'],
    ['/points/tiktok/', 'tiktok'],
    ['/points/twitter', 'x'],
    ['/points/twitter/', 'x'],
  ];
  for (const [source, publicitySource] of expected) {
    assert.ok(
      hasRewrite(source, `/api/points/publicity/redirect?source=${publicitySource}`),
      `expected ${source} to rewrite to ${publicitySource} publicity tracking`,
    );
  }
});
