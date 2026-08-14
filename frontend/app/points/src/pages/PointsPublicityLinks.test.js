import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const apiClient = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const vercelConfig = JSON.parse(await readFile(new URL('../../../../../vercel.json', import.meta.url), 'utf8'));

function hasRewrite(source, destination) {
  return Array.isArray(vercelConfig.rewrites)
    && vercelConfig.rewrites.some(rule => rule.source === source && rule.destination === destination);
}

test('points app tracks social-bio conversions after authentication', () => {
  assert.match(apiClient, /trackPublicityConversion/);
  assert.match(apiClient, /trackPublicityLanding/);
  assert.match(apiClient, /\/api\/points\/publicity\/landing/);
  assert.match(apiClient, /\/api\/points\/publicity\/conversion/);
  assert.match(appSource, /trackPublicityConversion/);
  assert.match(appSource, /trackPublicityLanding/);
  assert.match(appSource, /publicityConversionUsernameRef/);
});

test('points app reads hidden root-fragment social links and cleans the URL', () => {
  assert.match(appSource, /publicitySourceFromHash/);
  assert.match(appSource, /publicitySourceFromSearch/);
  assert.match(appSource, /cleanPublicityUrl/);
  assert.match(appSource, /a:\s*'instagram'/);
  assert.match(appSource, /b:\s*'tiktok'/);
  assert.match(appSource, /c:\s*'x'/);
  assert.match(appSource, /window\.history\.replaceState/);
});

test('points app exposes local routes for clean public social links', () => {
  assert.match(appSource, /PublicityRedirect/);
  assert.match(appSource, /path="\/i"/);
  assert.match(appSource, /path="\/t"/);
  assert.match(appSource, /path="\/x"/);
  assert.match(appSource, /path="\/instagram"/);
  assert.match(appSource, /path="\/tiktok"/);
  assert.match(appSource, /path="\/twitter"/);

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
      `expected ${source} to rewrite to publicity tracking in production`,
    );
  }
});

test('admin stats renders copyable production bio links with channel metrics', () => {
  assert.match(adminSource, /AdminPublicityPanel/);
  assert.match(adminSource, /Enlaces de publicidad/);
  assert.match(adminSource, /https:\/\/pronos\.io/);
  assert.match(adminSource, /row\.path/);
  assert.match(adminSource, /href = `https:\/\/pronos\.io\$\{row\.path\}`/);
  assert.match(adminSource, /monthVisits/);
  assert.match(adminSource, /monthConversionRate/);
  assert.match(adminSource, /navigator\.clipboard/);
});
