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
  assert.ok(
    hasRewrite('/i', '/api/points/publicity/redirect?source=instagram'),
    'expected /i to rewrite to Instagram publicity tracking',
  );
  assert.ok(
    hasRewrite('/t', '/api/points/publicity/redirect?source=tiktok'),
    'expected /t to rewrite to TikTok publicity tracking',
  );
  assert.ok(
    hasRewrite('/x', '/api/points/publicity/redirect?source=x'),
    'expected /x to rewrite to X publicity tracking',
  );
  assert.ok(
    hasRewrite('/instagram', '/api/points/publicity/redirect?source=instagram'),
    'expected /instagram to rewrite to Instagram publicity tracking',
  );
  assert.ok(
    hasRewrite('/tiktok', '/api/points/publicity/redirect?source=tiktok'),
    'expected /tiktok to rewrite to TikTok publicity tracking',
  );
  assert.ok(
    hasRewrite('/x', '/api/points/publicity/redirect?source=x'),
    'expected /x to rewrite to X publicity tracking',
  );
});
