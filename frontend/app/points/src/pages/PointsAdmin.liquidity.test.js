import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');

test('manual creation shows type-specific defaults and keeps admin-entered liquidity when the category changes', () => {
  assert.match(source, /import \{ defaultPointsSeedLiquidity \} from '\.\.\/\.\.\/\.\.\/\.\.\/api\/_lib\/market-liquidity\.js'/);
  assert.match(source, /if \(!liquidityCustomized\) setForm/);
  assert.match(source, /setLiquidityCustomized\(true\)/);
  assert.match(source, /outcomeCount: form\.outcomes\.length/);
});
const panel = await readFile(new URL('../components/MarketLiquidityPanel.jsx', import.meta.url), 'utf8');
const api = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('admin edit exposes price-preserving liquidity only for active Points unified parents', () => {
  assert.match(source, /market\.status === 'active' && market\.ammMode !== 'parallel' && \(market\.mode \|\| 'points'\) === 'points' && !market\.parentId/);
  assert.match(source, /<MarketLiquidityPanel marketId=\{market\.id\} onFunded=\{onSaved\}/);
});

test('funding UI requires a simulated amount, confirmation, and a stable idempotency key', () => {
  assert.match(panel, /crypto\.randomUUID\(\)/);
  assert.match(panel, /!confirmed \|\| !preview\?\.plan \|\| !requestId\.current/);
  assert.match(panel, /expectedReserves: preview\.reserves, requestId: requestId\.current/);
  assert.match(panel, /type="checkbox" checked=\{confirmed\}/);
  assert.match(panel, /funding_preview_stale/);
  assert.match(panel, /No es un depósito de MXNB/);
  assert.match(api, /getJson\(`\/api\/points\/admin\/market-liquidity\?\$\{query\}`\)/);
  assert.match(api, /postJson\('\/api\/points\/admin\/market-liquidity', \{ marketId, amount, expectedReserves, requestId \}\)/);
});

test('liquidity UI includes both stress targets and a selector for active parallel legs', () => {
  assert.match(panel, /preview\.targets\.map\(target/);
  assert.match(panel, /target\.impactsBefore\.map/);
  assert.match(source, /liquidityLegId/);
  assert.match(source, /initialParallelReserveRows\.filter\(row => row\.status === 'active'\)/);
  assert.match(source, /<MarketLiquidityPanel key=\{liquidityLegId\} marketId=\{liquidityLegId\}/);
});
