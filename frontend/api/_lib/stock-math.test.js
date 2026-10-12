import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStockFill, assertStockQuoteFresh, buildStockFill, fixed, stockPositionValue } from './stock-math.js';

const book = { szDecimals: 3, fx: { rate: '20', date: '2026-10-12' },
  levels: [[{ px: '99', sz: '1000' }], [{ px: '100', sz: '1000' }]] };
test('buy keeps the rounding remainder and includes fees in cost basis', () => {
  const fill = buildStockFill({ side: 'buy', amount: '500', quote: book });
  assert.equal(fill.quantity, '0.249');
  assert.equal(fill.gross, '498');
  assert.equal(fill.fee, '0.498');
  assert.equal(fill.total, '498.498');
  assert.equal(fill.unspent, '1.502');
  assert.equal(applyStockFill(null, fill).costBasis, '498.498');
});
test('partial and full sales conserve cost basis and realize net proceeds', () => {
  const position = { quantity: '0.249', cost_basis: '498.498', realized_pnl: '0' };
  const first = buildStockFill({ side: 'sell', quantity: '0.1', positionQuantity: position.quantity, quote: book });
  const updated = applyStockFill(position, first);
  assert.equal(first.total, '197.802');
  assert.equal(updated.costBasis, '298.298');
  assert.equal(updated.tradePnl, '-2.398');
  const final = buildStockFill({ side: 'sell', sellAll: true, positionQuantity: updated.quantity, quote: book });
  const closed = applyStockFill({ quantity: updated.quantity, cost_basis: updated.costBasis, realized_pnl: updated.realizedPnl }, final);
  assert.equal(closed.quantity, '0');
  assert.equal(closed.costBasis, '0');
  assert.equal(closed.realizedPnl, '-5.97102');
});
test('buys consume depth and reject materially unfilled budgets', () => {
  const depth = { ...book, levels: [book.levels[0], [{ px: '100', sz: '0.1' }, { px: '110', sz: '2' }]] };
  const fill = buildStockFill({ side: 'buy', amount: '500', quote: depth });
  assert.equal(fill.quantity, '0.236');
  assert.equal(fill.total, '499.6992');
  assert.equal(fill.fills.length, 2);
  assert.throws(() => buildStockFill({ side: 'buy', amount: '500', quote: { ...book, levels: [book.levels[0], [{ px: '100', sz: '0.1' }]] } }), { code: 'stock_insufficient_liquidity' });
  assert.throws(() => buildStockFill({ side: 'sell', sellAll: true, positionQuantity: '2000', quote: book }), { code: 'stock_insufficient_liquidity' });
});
test('no leverage, overselling, unsupported precision, or below-minimum buys', () => {
  assert.throws(() => buildStockFill({ side: 'buy', amount: '99.999999', quote: book }), { code: 'stock_minimum_amount' });
  assert.throws(() => buildStockFill({ side: 'sell', quantity: '0.11', positionQuantity: '0.1', quote: book }), { code: 'insufficient_stock_quantity' });
  assert.throws(() => buildStockFill({ side: 'sell', quantity: '0.0001', positionQuantity: '1', quote: book }), { code: 'invalid_precision' });
  for (const amount of ['-1', 'NaN', 'Infinity', '1e6', '500.0000001', '1000001']) {
    assert.throws(() => buildStockFill({ side: 'buy', amount, quote: book }));
  }
});
test('quote freshness rejects old or future-dated books', () => {
  const now = Date.now();
  assertStockQuoteFresh({ bookTime: now - 9999, fetchedAt: now }, now);
  for (const bookTime of [now - 10000, now + 2001, NaN]) assert.throws(() => assertStockQuoteFresh({ bookTime, fetchedAt: now }, now), { code: 'stock_price_unavailable' });
});
test('accounting preserves all six money decimals across buy and sell cycles', () => {
  for (let i = 100; i <= 300; i += 7) {
    const fill = buildStockFill({ side: 'buy', amount: `${i}.123456`, quote: book });
    assert.equal(fixed(fill.total) + fixed(fill.unspent), fixed(`${i}.123456`));
    const open = applyStockFill(null, fill);
    const sold = buildStockFill({ side: 'sell', sellAll: true, positionQuantity: open.quantity, quote: book });
    const closed = applyStockFill({ quantity: open.quantity, cost_basis: open.costBasis }, sold);
    assert.equal(closed.costBasis, '0');
    assert.equal(closed.quantity, '0');
    assert.equal(fixed(sold.total) - fixed(fill.total), BigInt(Math.round(Number(closed.realizedPnl) * 1000000)));
  }
  assert.equal(stockPositionValue('0.249', '100', '20'), '498');
});
