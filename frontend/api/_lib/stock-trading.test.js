import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { STOCK_SCHEMA_MIGRATIONS } from './stock-schema.js';
import { createStockQuote, executeStockTrade, stockOrderRequest } from './stock-trading.js';
import { readStockPortfolio } from './stock-portfolio.js';

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE points_cycles(id SERIAL PRIMARY KEY,label TEXT,started_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,status TEXT,closed_at TIMESTAMPTZ);
    CREATE TABLE points_app_settings(key TEXT PRIMARY KEY,value JSONB);
    CREATE TABLE points_balances(username TEXT PRIMARY KEY,balance NUMERIC(20,6),updated_at TIMESTAMPTZ);
    CREATE TABLE points_distributions(id SERIAL PRIMARY KEY,username TEXT,amount NUMERIC(20,6),kind TEXT,reference_id INTEGER,reason TEXT);
    INSERT INTO points_cycles(label,started_at,ends_at,status) VALUES('Test',NOW()-INTERVAL '60 days',NOW()+INTERVAL '1 day','active');
    INSERT INTO points_app_settings VALUES('points_cycles_paused','false');
    INSERT INTO points_balances VALUES('fran',10000,NOW()),('other',10000,NOW());`);
  for (const sql of STOCK_SCHEMA_MIGRATIONS) await db.exec(sql);
  const book = { ticker: 'AAPL', szDecimals: 3, markPriceUsd: '100', bookTime: Date.now(), fetchedAt: Date.now(),
    fx: { rate: '20', date: new Date().toISOString().slice(0, 10) }, levels: [[{ px: '99', sz: '1000' }], [{ px: '100', sz: '1000' }]] };
  const quote = request => db.transaction(tx => createStockQuote(tx, { username: 'fran', request: stockOrderRequest({ ticker: 'AAPL', ...request }), book: { ...book, bookTime: Date.now(), fetchedAt: Date.now() } }));
  const trade = (q, key = crypto.randomUUID(), username = 'fran', side = q.side) => db.transaction(tx => executeStockTrade(tx, { username, side, quoteId: q.quoteId, idempotencyKey: key }));
  return { db, quote, trade };
}
test('real SQL buy/sell updates wallet, positions, immutable audit and PnL', async t => {
  const { db, quote, trade } = await setup(t);
  const result = await trade(await quote({ side: 'buy', amount: '500' }));
  assert.equal(result.balance, '9501.502');
  const wallet = (await db.query('SELECT balance FROM points_balances WHERE username=$1', ['fran'])).rows[0];
  assert.equal(wallet.balance, '9501.502000');
  assert.equal((await db.query('SELECT amount FROM points_distributions')).rows[0].amount, '-498.498000');
  const sale = await trade(await quote({ side: 'sell', sellAll: true }));
  assert.equal(sale.position.costBasis, '0');
  assert.equal(sale.position.quantity, '0');
  assert.equal(sale.position.realizedPnl, '-5.97102');
  const portfolio = await db.transaction(tx => readStockPortfolio(tx, { username: 'fran' }));
  assert.equal(portfolio.positions.length, 0);
  assert.equal(portfolio.summary.realizedPnl, -5.97102);
  assert.equal(portfolio.trades.length, 2);
  assert.ok(portfolio.series.length >= 2);
});
test('duplicate retries return the original result once, including after expiry', async t => {
  const { db, quote, trade } = await setup(t);
  const q = await quote({ side: 'buy', amount: '500' });
  const key = crypto.randomUUID();
  const [first, duplicate] = await Promise.all([trade(q, key), trade(q, key)]);
  assert.equal(first.tradeId, duplicate.tradeId);
  assert.equal(duplicate.replayed, true);
  await db.query("UPDATE points_stock_quotes SET expires_at=NOW()-INTERVAL '1 minute'");
  assert.equal((await trade(q, key)).tradeId, first.tradeId);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_stock_trades')).rows[0].n, 1);
  const another = await quote({ side: 'buy', amount: '500' });
  await assert.rejects(trade(another, key), { code: 'idempotency_conflict' });
});
test('quote ownership, expiry, side and single consumption are enforced', async t => {
  const { db, quote, trade } = await setup(t);
  const q = await quote({ side: 'buy', amount: '500' });
  await assert.rejects(trade(q, undefined, 'other'), { code: 'invalid_quote' });
  await assert.rejects(trade(q, undefined, 'fran', 'sell'), { code: 'invalid_quote' });
  await trade(q);
  await assert.rejects(trade(q), { code: 'stock_quote_used' });
  const expired = await quote({ side: 'buy', amount: '500' });
  await db.query("UPDATE points_stock_quotes SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [expired.quoteId]);
  await assert.rejects(trade(expired), { code: 'stock_quote_expired' });
});
test('insufficient funds and interrupted transactions leave no partial writes', async t => {
  const { db, quote, trade } = await setup(t);
  await db.query('UPDATE points_balances SET balance=100');
  const q = await quote({ side: 'buy', amount: '500' });
  await assert.rejects(trade(q), { code: 'insufficient_balance' });
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_stock_positions')).rows[0].n, 0);
  await db.query('UPDATE points_balances SET balance=10000');
  await assert.rejects(db.transaction(tx => executeStockTrade({ query: async (sql, params) => {
    if (sql.startsWith('INSERT INTO points_stock_trades')) throw new Error('simulated database interruption');
    return tx.query(sql, params);
  } }, { username: 'fran', side: 'buy', quoteId: q.quoteId, idempotencyKey: crypto.randomUUID() })), /interruption/);
  assert.equal((await db.query('SELECT balance FROM points_balances WHERE username=$1', ['fran'])).rows[0].balance, '10000.000000');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_stock_positions')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_stock_valuations')).rows[0].n, 0);
});
test('closed cycles archive exposure; old shares and quotes cannot fund a new cycle', async t => {
  const { db, quote, trade } = await setup(t);
  await trade(await quote({ side: 'buy', amount: '500' }));
  const oldSale = await quote({ side: 'sell', sellAll: true });
  await db.exec(`UPDATE points_cycles SET status='closed',closed_at=NOW();
    INSERT INTO points_cycles(label,started_at,ends_at,status) VALUES('Next',NOW()-INTERVAL '1 hour',NOW()+INTERVAL '30 days','active');
    UPDATE points_balances SET balance=10000;`);
  await assert.rejects(trade(oldSale), { code: 'invalid_quote' });
  await assert.rejects(quote({ side: 'sell', sellAll: true }), { code: 'insufficient_stock_quantity' });
  const previous = await db.transaction(tx => readStockPortfolio(tx, { username: 'fran', scope: 'previous' }));
  assert.equal(previous.positions[0].quantity, '0.249000000000000000');
  assert.equal(previous.positions[0].archived, true);
  const current = await db.transaction(tx => readStockPortfolio(tx, { username: 'fran' }));
  assert.equal(current.positions.length, 0);
});
test('pause and operation cutoff block quotes and confirmed trades', async t => {
  const { db, quote, trade } = await setup(t);
  const q = await quote({ side: 'buy', amount: '500' });
  await db.query("UPDATE points_app_settings SET value='{\"paused\":true}'");
  await assert.rejects(trade(q), { code: 'stock_cycle_closed' });
  await assert.rejects(quote({ side: 'buy', amount: '500' }), { code: 'stock_cycle_closed' });
  await db.query("UPDATE points_app_settings SET value='false'");
  await db.query("UPDATE points_cycles SET ends_at=NOW()-INTERVAL '1 minute'");
  await assert.rejects(trade(q), { code: 'stock_cycle_closed' });
});
test('unavailable marks preserve holdings and flag the previous valuation as stale', async t => {
  const { db, quote, trade } = await setup(t);
  await trade(await quote({ side: 'buy', amount: '500' }));
  const result = await db.transaction(tx => readStockPortfolio(tx, { username: 'fran', market: { assets: [], fx: { rate: '20' }, stale: false } }));
  assert.equal(result.stale, true);
  assert.equal(result.positions[0].stale, true);
  assert.equal(result.summary.currentValue, 498);
});
