import test from 'node:test';
import assert from 'node:assert/strict';
import { marketChartClock } from './points-chart-clock.js';
import { chartWindowsFromRows, loadChartWindows } from './points-chart-windows.js';

const close = Date.parse('2026-10-14T05:00:00Z');
const hour = 3_600_000;

test('active clocks advance until the trading deadline, then freeze even while pending resolution', () => {
  const market = { status: 'active', endTime: new Date(close).toISOString() };
  assert.deepEqual(marketChartClock(market, close - hour), { endMs: close - hour, frozen: false });
  for (const now of [close, close + hour, close + 1000 * hour]) {
    assert.deepEqual(marketChartClock(market, now), { endMs: close, frozen: true });
  }
});

test('resolved and canceled markets use the earlier of close and settlement, never the time of viewing', () => {
  for (const status of ['resolved', 'canceled']) {
    const market = { status, end_time: close, resolved_at: close + hour };
    assert.deepEqual(marketChartClock(market, close + 1000 * hour), { endMs: close, frozen: true });
    market.resolved_at = close - hour;
    assert.deepEqual(marketChartClock(market, close + hour), { endMs: close - hour, frozen: true });
    market.end_time = null;
    assert.deepEqual(marketChartClock(market, close + hour), { endMs: close - hour, frozen: true });
  }
});

test('legacy terminal markets fall back to dated trade/creation evidence; undated open markets remain live', () => {
  assert.deepEqual(marketChartClock({ status: 'resolved', lastTradeAt: close }, close + hour), { endMs: close, frozen: true });
  assert.deepEqual(marketChartClock({ status: 'canceled', end_time: 'invalid', created_at: close }, close + hour), { endMs: close, frozen: true });
  assert.deepEqual(marketChartClock({ status: 'active', end_time: 'invalid' }, close), { endMs: close, frozen: false });
});

test('parallel legs share their parent window while early-resolved legs cannot add post-resolution data', () => {
  const rows = [1, 2].map(id => ({ id, parent_id: 10, parent_status: 'resolved',
    parent_end_time: close, parent_resolved_at: close + hour, parent_created_at: close - 72 * hour,
    status: id === 1 ? 'resolved' : 'active', end_time: close,
    resolved_at: id === 1 ? close - 48 * hour : null }));
  const windows = chartWindowsFromRows(rows, 24, close + 1000 * hour);
  assert.deepEqual(windows.map(row => row.start), [new Date(close - 24 * hour).toISOString(), new Date(close - 24 * hour).toISOString()]);
  assert.ok(windows.every(row => row.frozen && row.end === new Date(close).toISOString()));
  assert.equal(windows[0].dataEnd, new Date(close - 48 * hour).toISOString());
  assert.equal(windows[1].dataEnd, new Date(close).toISOString());
});

test('window loader keeps each market cutoff distinct and omits nonexistent ids', async () => {
  const rows = [1, 2].map(id => ({ id, status: 'resolved', end_time: close - id * hour }));
  const sql = async () => rows;
  const result = await loadChartWindows(sql, [1, 2, 999], 4);
  assert.deepEqual(result.ids, [1, 2]);
  assert.deepEqual(result.ends, rows.map(row => new Date(row.end_time).toISOString()));
  assert.deepEqual(result.starts, rows.map(row => new Date(row.end_time - 4 * hour).toISOString()));
  assert.equal(result.frozen, true);
  assert.equal((await loadChartWindows(async () => [], [999], 4)).frozen, false);
});
