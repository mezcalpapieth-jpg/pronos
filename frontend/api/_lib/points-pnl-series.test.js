import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPnlSeries } from './points-pnl-series.js';

const T0 = Date.UTC(2026, 6, 1, 12, 0, 0);
const MIN = 60_000;

function at(offsetMinutes) {
  return new Date(T0 + offsetMinutes * MIN).toISOString();
}

test('a buy alone does not move PnL — cash out is replaced by shares worth the same', () => {
  const { series } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots: [
      { marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) },
    ],
    nowMs: T0 + 10 * MIN,
  });

  // 200 shares at 0.50 = 100 of value against 100 spent → flat at zero.
  assert.ok(series.length >= 1);
  for (const point of series) assert.equal(point.v, 0);
});

test('an open position marks to market as the price moves', () => {
  const { series, current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots: [
      { marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) },
      { marketId: 1, prices: [0.8, 0.2], snapshottedAt: at(5) },
    ],
    nowMs: T0 + 5 * MIN,
  });

  // 200 shares now worth 0.80 each = 160 against 100 spent.
  assert.equal(current, 60);
  assert.equal(series[0].v, 0);
});

test('a resolved win is worth full value before it is claimed', () => {
  const { current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    markets: [
      { marketId: 1, outcomeCount: 2, status: 'resolved', outcome: 0, resolvedAt: at(10) },
    ],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 20 * MIN,
  });

  // 200 winning shares settle at 1.00 each = 200 against 100 spent.
  assert.equal(current, 100);
});

test('claiming a win does not double-count the payout', () => {
  const unclaimed = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'resolved', outcome: 0, resolvedAt: at(10) }],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 30 * MIN,
  });

  const claimed = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
      { marketId: 1, side: 'redeem', outcomeIndex: 0, shares: 200, collateral: 200, createdAt: at(20) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'resolved', outcome: 0, resolvedAt: at(10) }],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 30 * MIN,
  });

  assert.equal(claimed.current, unclaimed.current);
  assert.equal(claimed.current, 100);
});

test('a resolved loss drops to the full stake at resolution time', () => {
  const { series, current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'resolved', outcome: 1, resolvedAt: at(10) }],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 20 * MIN,
  });

  assert.equal(current, -100);
  // The market resolved with no trade of its own, so the drop only appears
  // if resolution is itself a sample point.
  assert.ok(series.some(p => p.v === 0), 'curve should sit at zero before resolution');
});

test('selling out locks in the realized gain', () => {
  const { current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
      { marketId: 1, side: 'sell', outcomeIndex: 0, shares: 200, collateral: 150, createdAt: at(5) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots: [
      { marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) },
      { marketId: 1, prices: [0.75, 0.25], snapshottedAt: at(5) },
    ],
    nowMs: T0 + 30 * MIN,
  });

  assert.equal(current, 50);
});

test('a cancel refund unwinds the position instead of leaving it marked', () => {
  const { current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    refunds: [{ marketId: 1, amount: 100, createdAt: at(10) }],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'canceled', outcome: null, resolvedAt: at(10) }],
    snapshots: [{ marketId: 1, prices: [0.9, 0.1], snapshottedAt: at(5) }],
    nowMs: T0 + 20 * MIN,
  });

  // Refunded in full: net zero, and the 0.90 snapshot must not leak in.
  assert.equal(current, 0);
});

test('a resolution correction reversal debits cash without unwinding the market', () => {
  const { current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 100, collateral: 100, createdAt: at(0) },
      { marketId: 1, side: 'buy', outcomeIndex: 1, shares: 100, collateral: 100, createdAt: at(1) },
      { marketId: 1, side: 'redeem', outcomeIndex: 0, shares: 100, collateral: 140, createdAt: at(10) },
    ],
    refunds: [{ marketId: 1, kind: 'redemption_reversal', amount: -140, createdAt: at(20) }],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'resolved', outcome: 1, resolvedAt: at(15) }],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 30 * MIN,
  });

  assert.equal(current, -100);
});

test('PnL accumulates across several markets at once', () => {
  const { current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
      { marketId: 2, side: 'buy', outcomeIndex: 0, shares: 100, collateral: 50, createdAt: at(1) },
    ],
    markets: [
      { marketId: 1, outcomeCount: 2, status: 'resolved', outcome: 0, resolvedAt: at(10) },
      { marketId: 2, outcomeCount: 2, status: 'resolved', outcome: 1, resolvedAt: at(10) },
    ],
    snapshots: [
      { marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) },
      { marketId: 2, prices: [0.5, 0.5], snapshottedAt: at(1) },
    ],
    nowMs: T0 + 20 * MIN,
  });

  // Market 1 wins (+100), market 2 loses its 50 stake (−50).
  assert.equal(current, 50);
});

test('a windowed request still starts from the true cumulative PnL, not zero', () => {
  const opts = {
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
      { marketId: 1, side: 'sell', outcomeIndex: 0, shares: 200, collateral: 300, createdAt: at(5) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 100 * MIN,
  };

  const windowed = buildPnlSeries({ ...opts, fromMs: T0 + 50 * MIN });

  // The +200 was realized before the window opened; it must carry in.
  assert.ok(windowed.series.length > 0);
  assert.equal(windowed.series[0].v, 200);
  assert.equal(windowed.current, 200);
});

test('a market with no snapshot yet is valued at its opening odds', () => {
  const { current } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 200, collateral: 100, createdAt: at(0) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots: [],
    nowMs: T0 + 10 * MIN,
  });

  // Uniform 1/n = 0.50 → 200 shares worth 100 against 100 spent.
  assert.equal(current, 0);
});

test('a user with no trades gets an empty series rather than a flat fake line', () => {
  const { series, current } = buildPnlSeries({ trades: [], markets: [], nowMs: T0 });
  assert.deepEqual(series, []);
  assert.equal(current, 0);
});

test('long histories are thinned but keep their first and last point', () => {
  const trades = [];
  const snapshots = [];
  for (let i = 0; i < 500; i += 1) {
    trades.push({ marketId: 1, side: 'buy', outcomeIndex: 0, shares: 2, collateral: 1, createdAt: at(i) });
    snapshots.push({ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(i) });
  }

  const { series } = buildPnlSeries({
    trades,
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots,
    nowMs: T0 + 600 * MIN,
    maxPoints: 60,
  });

  assert.ok(series.length <= 60, `expected ≤60 points, got ${series.length}`);
  assert.equal(series[0].t, Math.round(T0 / 1000));
  assert.equal(series[series.length - 1].t, Math.round((T0 + 600 * MIN) / 1000));
});

test('series timestamps are ascending', () => {
  const { series } = buildPnlSeries({
    trades: [
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 100, collateral: 50, createdAt: at(30) },
      { marketId: 1, side: 'buy', outcomeIndex: 0, shares: 100, collateral: 50, createdAt: at(2) },
    ],
    markets: [{ marketId: 1, outcomeCount: 2, status: 'open' }],
    snapshots: [{ marketId: 1, prices: [0.5, 0.5], snapshottedAt: at(0) }],
    nowMs: T0 + 60 * MIN,
  });

  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i].t >= series[i - 1].t, 'timestamps must not go backwards');
  }
});
