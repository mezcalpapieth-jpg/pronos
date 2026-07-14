/**
 * Static checks for the Points pending-markets admin queue.
 *
 * Run with:
 *   node --test frontend/app/points/src/pages/PointsAdmin.pending-markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const navSource = await readFile(new URL('../components/PointsNav.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../lib/pointsApi.js', import.meta.url), 'utf8');

test('Points admin exposes a re-add action for rejected generated markets', () => {
  assert.match(source, /filter === 'rejected'/);
  assert.match(source, /review\(r\.id,\s*'readd'\)/);
  assert.match(source, /Reagregar/);
  assert.match(apiSource, /adminReviewPendingMarket\(id,\s*action,\s*note\)/);
});

test('Points admin can edit generated markets and per-option liquidity before approval', () => {
  assert.match(source, /PendingMarketEditModal/);
  assert.match(source, /setEditingPending\(r\)/);
  assert.match(source, /adminEditPendingMarket/);
  assert.match(source, /seedLiquidities/);
  assert.match(source, /Liquidez opción/);
  assert.match(apiSource, /export async function adminEditPendingMarket/);
  assert.match(apiSource, /action:\s*'edit'/);
});

test('Points admin tabs show pending-work badges outside the active tab', () => {
  assert.match(source, /adminTaskCounts/);
  assert.match(source, /adminListTaskCounts\(\)/);
  assert.match(apiSource, /export async function adminListTaskCounts/);
  assert.match(apiSource, /adminListPendingMarkets\('pending'\)/);
  assert.match(apiSource, /\/api\/points\/admin\/markets\?status=pending/);
  assert.match(apiSource, /adminListSocialTasks\('pending'\)/);
  assert.match(apiSource, /total:/);
  assert.match(source, /tab !== t\.id/);
  assert.match(source, /taskCount > 0/);
});

test('Points nav surfaces admin work count outside admin', () => {
  assert.match(navSource, /adminListTaskCounts/);
  assert.match(navSource, /adminTaskTotal/);
  assert.match(navSource, /points\.nav\.admin/);
  assert.match(navSource, /adminTaskTotal > 0/);
});

test('Points nav exposes a compact mobile menu with identity and hidden routes', () => {
  assert.match(navSource, /points-mobile-menu/);
  assert.match(navSource, /points-mobile-menu-user/);
  assert.match(navSource, /user\?\.username/);
  assert.match(navSource, /balance\.toLocaleString\('es-MX'\)/);
  assert.match(navSource, /points\.nav\.howItWorks/);
  assert.match(navSource, /setMobileMenuOpen/);
});

test('Points admin can pause public cycles and restart them later', () => {
  assert.match(source, /adminPauseCycles/);
  assert.match(source, /Pausar ciclos/);
  assert.match(source, /Reanudar ciclos/);
  assert.match(apiSource, /export async function adminPauseCycles/);
  assert.match(apiSource, /action:\s*'pause'/);
});

test('Points markets filter surfaces por resolver count while inside Mercados', () => {
  assert.match(source, /pendingResolveCount=\{adminTaskCounts\.markets\}/);
  assert.match(source, /function MarketsTable\(\{ onQueueChange, pendingResolveCount = 0 \}\)/);
  assert.match(source, /s\.key === 'pending' \? pendingResolveCount : 0/);
  assert.match(source, /taskCount > 0/);
});

test('Points admin can cancel active and por resolver markets', () => {
  assert.match(source, /adminCancelMarket/);
  assert.match(source, /Anular mercado/);
  assert.match(source, /filter === 'pending'/);
  assert.match(source, /cancelMarket\(m\)/);
  assert.match(source, /onCancel=\{cancelMarket\}/);
  assert.match(source, /actionMode === 'cancel'/);
  assert.match(source, /Se devolverá el costo base/);
});
