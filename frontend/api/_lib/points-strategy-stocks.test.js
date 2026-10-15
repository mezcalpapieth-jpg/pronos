import test from 'node:test';
import assert from 'node:assert/strict';
import { readStockStrategyAudit } from './points-strategy-stocks.js';

function database({ users = [], assets = [], trades = [], participants = 20, available = true } = {}) {
  const queries = [];
  return { queries, async query(sql, params) {
    queries.push({ sql, params });
    assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE|CREATE|ALTER)\b/);
    if (sql.includes('to_regclass')) return { rows: [{ trades: available, positions: available, marks: available }] };
    if (sql.includes('WITH position_values')) return { rows: users };
    if (sql.includes('AS count FROM')) return { rows: [{ count: participants }] };
    if (sql.includes('WITH trading')) return { rows: assets };
    if (sql.includes('SELECT id,username')) return { rows: trades };
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
}
const options = { cycleId: 5, startsAt: '2026-10-01T14:00:00Z', endsAt: '2026-11-01T05:59:59Z', now: new Date('2026-10-16T00:00:00Z') };

test('Stock metrics cover all users even when detail rows are limited', async () => {
  const db = database({ users: [
    { username: 'a', trades: 2, buys: 1, sells: 1, volume: '199.800000', invested: '100.000000', proceeds: '99.700000',
      fees: '0.200000', realized_pnl: '-0.300000', current_value: '0', cost_basis: '0', has_positions: true, last_trade: '2026-10-15T23:00:00Z' },
    { username: 'b', trades: 1, buys: 1, sells: 0, volume: '900', invested: '901', fees: '1',
      realized_pnl: '0', open_positions: 1, current_value: '950', cost_basis: '901', has_positions: true, stale: true },
  ] });
  const audit = await readStockStrategyAudit(db, { ...options, limit: 1 });
  assert.equal(audit.userCount, 2);
  assert.equal(audit.users.length, 1);
  assert.equal(audit.summary.investors, 2);
  assert.equal(audit.summary.activeInvestors, 1);
  assert.equal(audit.summary.adoptionPercent, 10);
  assert.equal(audit.summary.trades, 3);
  assert.equal(audit.summary.volume, 1099.8);
  assert.equal(audit.summary.realizedPnl, -0.3);
  assert.equal(audit.summary.unrealizedPnl, 49);
  assert.equal(audit.summary.staleHolders, 1);
  for (const { sql, params } of db.queries.slice(1)) {
    assert.ok(sql.includes('cycle_id=$1'));
    assert.equal(params[0], 5);
  }
  assert.match(db.queries[1].sql, /origin='user'/);
  assert.match(db.queries[1].sql, /points_stock_cycle_marks/);
});

test('missing prices stay unknown rather than showing a fabricated zero or loss', async () => {
  const audit = await readStockStrategyAudit(database({ users: [{ username: 'a', trades: 1, buys: 1,
    open_positions: 1, current_value: null, cost_basis: '100', has_positions: true, stale: true }] }), options);
  assert.equal(audit.summary.currentValue, null);
  assert.equal(audit.summary.unrealizedPnl, null);
  assert.equal(audit.users[0].currentValue, null);
  assert.equal(audit.users[0].unrealizedPnl, null);
});

test('missing stock schema and an unused cycle have safe empty states', async () => {
  const missing = database({ available: false });
  assert.equal((await readStockStrategyAudit(missing, options)).available, false);
  assert.equal(missing.queries.length, 1);
  const empty = await readStockStrategyAudit(database(), options);
  assert.equal(empty.summary.investors, 0);
  assert.equal(empty.summary.volume, 0);
  assert.deepEqual(empty.users, []);
});
