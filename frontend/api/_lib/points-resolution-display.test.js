import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvedMarketPrices, appendResolutionPoint } from './points-resolution-display.js';
import { chartWindowsFromRows } from './points-chart-windows.js';

const close = Date.parse('2026-10-14T05:00:00Z');
const hour = 3_600_000;

test('settlement prices honor every unified winner and reject missing or invalid results', () => {
  for (const outcome of [0, 1, 2]) {
    assert.deepEqual(resolvedMarketPrices({ status: 'resolved', outcome, outcomes: ['A', 'B', 'C'] }),
      [0, 1, 2].map(index => index === outcome ? 1 : 0));
  }
  for (const outcome of [null, '', -1, 2, 0.5, 'invalid']) {
    assert.equal(resolvedMarketPrices({ status: 'resolved', outcome, outcomes: ['Yes', 'No'] }), null);
  }
  for (const status of ['active', 'canceled', 'pending']) {
    assert.equal(resolvedMarketPrices({ status, outcome: 0, outcomes: ['Yes', 'No'] }), null);
  }
});

test('an older resolved market ends at its result time and stays identical when viewed later', () => {
  const market = { id: 1, status: 'resolved', outcome: 1, outcomes: ['A', 'B'], end_time: close, resolved_at: close + hour };
  const series = [{ t: close / 1000 - 60, p: 63 }];
  const build = now => appendResolutionPoint(series, chartWindowsFromRows([market], 24, now)[0], 0);
  assert.deepEqual(build(close + 2 * hour), [...series, { t: (close + hour) / 1000, p: 0 }]);
  assert.deepEqual(build(close + 1000 * hour), build(close + 2 * hour));
  const window = chartWindowsFromRows([{ ...market, outcome: 0 }], 24, close + 2 * hour)[0];
  assert.equal(appendResolutionPoint(series, window, 0).at(-1).p, 100);
});

test('parallel legs settle independently, including multiple winners and early losing legs', () => {
  const rows = [0, 1, 2].map(index => ({ id: index + 1, parent_id: 10,
    parent_status: 'resolved', parent_end_time: close, parent_resolved_at: close + hour,
    status: 'resolved', outcome: index === 2 ? 1 : 0, outcomes: ['Yes', 'No'],
    end_time: close, resolved_at: index === 2 ? close - 48 * hour : close + hour }));
  const windows = chartWindowsFromRows(rows, 24, close + 1000 * hour);
  assert.deepEqual(windows.map(window => appendResolutionPoint([], window, 0).at(-1).p), [100, 100, 0]);
  assert.equal(appendResolutionPoint([], windows[2], 0)[0].t, new Date(windows[2].start).getTime() / 1000);
});

test('unresolved and canceled charts do not invent a settlement point', () => {
  for (const status of ['active', 'canceled']) {
    const window = chartWindowsFromRows([{ id: 1, status, outcome: null, outcomes: ['A', 'B'], end_time: close }], 24, close + hour)[0];
    assert.deepEqual(appendResolutionPoint([], window, 0), []);
  }
});
