import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('./PointsAdmin.jsx', import.meta.url), 'utf8');
const apiSource = await readFile(new URL('../../../../api/points/admin/strategies.js', import.meta.url), 'utf8');
const stocksSource = await readFile(new URL('../components/AdminStocksAudit.jsx', import.meta.url), 'utf8');

test('Points admin exposes the strategies audit tab', () => {
  assert.match(adminSource, /useCallback/);
  assert.match(adminSource, /\['create', 'markets', 'stats', 'pending', 'social', 'support', 'deck', 'cycles', 'risk', 'api', 'launch', 'strategies'\]/);
  assert.match(adminSource, /\{ id: 'strategies', label: 'Estrategias' \}/);
  assert.match(adminSource, /\{tab === 'strategies' && <StrategiesPanel \/>\}/);
  assert.match(adminSource, /function StrategiesPanel\(\)/);
});

test('Strategies separates results, pending settlement and real credited payments', () => {
  assert.match(adminSource, /StrategyStatusPill status=\{ticket.status\}/);
  assert.match(adminSource, /ticket.realizedPnl == null \? 'Sin liquidar'/);
  assert.match(adminSource, /Ganada · pago pendiente/);
  assert.match(adminSource, /Acreditado:/);
  assert.match(adminSource, /summary.awaitingPayout/);
  assert.match(adminSource, /ticket.auditIssues/);
});

test('Strategies offers a Stock view with investor, asset and activity tables', () => {
  assert.match(adminSource, /\['stock', 'Stock'\]/);
  assert.match(adminSource, /strategyView === 'stock' && <AdminStocksAudit/);
  for (const label of ['Inversores', 'Participación', 'Volumen operado', 'Valor en posiciones', 'PnL realizado', 'PnL abierto', 'Por activo', 'Últimas operaciones']) assert.ok(stocksSource.includes(label));
  assert.match(stocksSource, /summary.staleHolders/);
  assert.match(stocksSource, /trade.origin === 'tournament_close'/);
});

test('Strategies panel audits combinadas and long hold through the admin endpoint', () => {
  assert.match(adminSource, /\/api\/points\/admin\/strategies\?\$\{q\.toString\(\)\}/);
  assert.match(adminSource, /Combinadas \/ Long Hold/);
  assert.match(adminSource, /Auditoría de estrategias del torneo/);
  assert.match(adminSource, /Pago potencial/);
  assert.match(adminSource, /PnL realizado/);
  assert.match(adminSource, /Bonos de convicción/);
  assert.match(adminSource, /snapshot cerrado/);
  assert.match(adminSource, /leaderboard en vivo/);
  assert.match(apiSource, /GET \/api\/points\/admin\/strategies/);
  assert.match(apiSource, /points_parlay_tickets/);
  assert.match(apiSource, /includeConvictionBreakdown/);
});
