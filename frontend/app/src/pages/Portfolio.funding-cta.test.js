import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portfolioSource = await readFile(new URL('./Portfolio.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../App.jsx', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/Nav.jsx', import.meta.url), 'utf8');

test('MVP portfolio shows Depositar first and Retirar only when MXNB is available', () => {
  assert.match(portfolioSource, /to="\/funding"/);
  assert.match(portfolioSource, />Depositar</);
  assert.match(portfolioSource, />Retirar</);
  assert.match(portfolioSource, /onchainBalance\s*>\s*0/);
  assert.match(portfolioSource, /var\(--orange\)/);
  assert.match(portfolioSource, /var\(--green\)/);
});

test('MVP routes and nav expose the funding page', () => {
  assert.match(appSource, /const FundingPage = lazy\(\(\) => import\('\.\/pages\/FundingPage\.jsx'\)\)/);
  assert.match(appSource, /path="\/funding"/);
  assert.match(navSource, /to="\/funding"/);
  assert.match(navSource, /t\('nav\.deposit'\)/);
});

test('MVP portfolio active and history markets link back to market detail', () => {
  assert.match(portfolioSource, /function portfolioMarketHref\(item\)/);
  assert.match(portfolioSource, /item\?\.parentMarketId\s*\|\|\s*item\?\.marketId/);
  assert.match(portfolioSource, /`\/market\?id=\$\{encodeURIComponent\(id\)\}`/);
  assert.match(portfolioSource, /to=\{marketHref\}/);
  assert.match(portfolioSource, /Ver mercado/);
});
