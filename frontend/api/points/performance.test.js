import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const helper = await readFile(new URL('../_lib/api-performance.js', import.meta.url), 'utf8');
const markets = await readFile(new URL('./markets.js', import.meta.url), 'utf8');
const leaderboard = await readFile(new URL('./leaderboard.js', import.meta.url), 'utf8');
const stats = await readFile(new URL('./stats.js', import.meta.url), 'utf8');
const currentCycle = await readFile(new URL('./cycles/current.js', import.meta.url), 'utf8');
const cycleHistory = await readFile(new URL('./cycles/history.js', import.meta.url), 'utf8');
const history = await readFile(new URL('./history.js', import.meta.url), 'utf8');
const adminStats = await readFile(new URL('./admin/stats.js', import.meta.url), 'utf8');
const orderbook = await readFile(new URL('./orderbook.js', import.meta.url), 'utf8');
const adminMarkets = await readFile(new URL('./admin/markets.js', import.meta.url), 'utf8');
const adminPendingMarkets = await readFile(new URL('./admin/pending-markets.js', import.meta.url), 'utf8');
const pointsSchema = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const migrate = await readFile(new URL('../migrate.js', import.meta.url), 'utf8');

test('shared api performance helper exposes cache headers, memory cache, and Server-Timing', () => {
  assert.match(helper, /export function setCacheHeaders/);
  assert.match(helper, /export async function cachedJson/);
  assert.match(helper, /export function createApiTimer/);
  assert.match(helper, /Server-Timing/);
  assert.match(helper, /API_TIMING_LOGS/);
});

test('public points reads use short cache headers and timing metadata', () => {
  for (const source of [markets, leaderboard, stats, currentCycle, cycleHistory, adminStats, orderbook]) {
    assert.match(source, /cachedJson/);
    assert.match(source, /createApiTimer/);
    assert.match(source, /setCacheHeaders/);
    assert.match(source, /X-Pronos-Cache/);
    assert.match(source, /timer\.end/);
  }
});

test('portfolio history remains uncached but timed', () => {
  assert.match(history, /createApiTimer/);
  assert.match(history, /timer\.time\('schema'/);
  assert.match(history, /timer\.time\('db_trades'/);
  assert.match(history, /timer\.time\('db_refunds'/);
  assert.doesNotMatch(history, /cachedJson/);
});

test('points schema and manual migration include hot-path indexes', () => {
  for (const source of [pointsSchema, migrate]) {
    assert.match(source, /idx_points_markets_active_parent_end/);
    assert.match(source, /idx_points_markets_featured_active_end/);
    assert.match(source, /idx_points_markets_category_status_end/);
    assert.match(source, /idx_points_markets_resolved_parent_time/);
    assert.match(source, /idx_points_balances_rank/);
    assert.match(source, /idx_points_trades_user_created/);
    assert.match(source, /idx_points_trades_market_side_user/);
    assert.match(source, /idx_points_limit_orders_market_outcome/);
    assert.match(source, /idx_points_limit_orders_user/);
    assert.match(source, /idx_points_distributions_user_kind_ref/);
  }
});

test('manual migration creates columns before partial indexes that reference them', () => {
  const parentColumn = migrate.indexOf('ADD COLUMN IF NOT EXISTS parent_id');
  const featuredColumn = migrate.indexOf('ADD COLUMN IF NOT EXISTS featured');
  const archivedColumn = migrate.indexOf('ADD COLUMN IF NOT EXISTS archived_at');
  const firstPartialIndex = migrate.indexOf('idx_points_markets_active_parent_end');
  assert.ok(parentColumn > 0 && parentColumn < firstPartialIndex);
  assert.ok(featuredColumn > 0 && featuredColumn < firstPartialIndex);
  assert.ok(archivedColumn > 0 && archivedColumn < firstPartialIndex);
});

test('high-volume admin list endpoints avoid row-star overfetch', () => {
  assert.doesNotMatch(adminMarkets, /SELECT\s+m\.\*/);
  assert.doesNotMatch(adminPendingMarkets, /SELECT\s+p\.\*/);
  assert.match(adminMarkets, /m\.resolver_config/);
  assert.match(adminPendingMarkets, /p\.resolver_config/);
});
