import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStockFill, assertStockQuoteFresh, buildStockFill, buildStockClosingFill, fixed, stockPositionValue } from './stock-math.js';

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

test('cutoff settlement closes exact quantities, fees and even sub-micropoint dust', () => {
  const mark = { price_usd: '120', fx_rate: '20', fx_date: '2026-10-09' };
  const fill = buildStockClosingFill('0.249', mark);
  assert.equal(fill.total, '597.0024'); assert.equal(fill.fee, '0.5976');
  const sold = applyStockFill({ quantity: '0.249', cost_basis: '498.498' }, fill);
  assert.equal(sold.quantity, '0'); assert.equal(sold.costBasis, '0'); assert.equal(sold.realizedPnl, '98.5044');
  const dust = buildStockClosingFill('0.000000000000000001', mark);
  assert.equal(dust.total, '0'); assert.equal(dust.fee, '0');
  assert.equal(applyStockFill({ quantity: dust.quantity, cost_basis: '0.000001' }, dust).realizedPnl, '-0.000001');
  assert.throws(() => buildStockClosingFill('1', { ...mark, price_usd: '0' }));
});

test('unit buys fill the exact requested quantity across depth and charge fees', () => {
  const depth = { ...book, levels: [book.levels[0], [{ px: '100', sz: '0.1' }, { px: '110', sz: '2' }]] };
  const fill = buildStockFill({ side: 'buy', quantity: '0.25', quote: depth });
  assert.equal(fill.quantity, '0.25');
  assert.equal(fill.gross, '530');
  assert.equal(fill.fee, '0.53');
  assert.equal(fill.total, '530.53');
  assert.equal(fill.unspent, '0');
  assert.equal(applyStockFill(null, fill).costBasis, '530.53');
  assert.throws(() => buildStockFill({ side: 'buy', quantity: '3', quote: depth }), { code: 'stock_insufficient_liquidity' });
});

test('unit buys enforce minimum, precision, maximum and exactly one input', () => {
  assert.throws(() => buildStockFill({ side: 'buy', quantity: '0.049', quote: book }), { code: 'stock_minimum_amount' });
  assert.equal(buildStockFill({ side: 'buy', quantity: '0.05', quote: book }).total, '100.1');
  assert.throws(() => buildStockFill({ side: 'buy', quantity: '0.0501', quote: book }), { code: 'invalid_precision' });
  assert.throws(() => buildStockFill({ side: 'buy', quantity: '500', quote: book }), { code: 'invalid_amount' });
  for (const request of [{}, { amount: '500', quantity: '0.25' }, { sellAll: true }]) {
    assert.throws(() => buildStockFill({ side: 'buy', ...request, quote: book }), { code: 'invalid_amount' });
  }
});

test('a monetary sale above the holding value is rejected even if quantity rounding would fit', () => {
  const btc = { szDecimals: 5, fx: { rate: '18.25' }, levels: [[{ px: '83325', sz: '10' }], [{ px: '83400', sz: '10' }]] };
  assert.throws(() => buildStockFill({ side: 'sell', amount: '500', positionQuantity: '0.00032', quote: btc }), { code: 'insufficient_stock_quantity' });
  const all = buildStockFill({ side: 'sell', sellAll: true, positionQuantity: '0.00032', quote: btc });
  assert.equal(all.gross, '486.618');
  assert.equal(all.total, '486.131382');
  assert.equal(all.quantity, '0.00032');
  assert.equal(buildStockFill({ side: 'sell', amount: '200', positionQuantity: '0.00032', quote: btc }).quantity, '0.00013');
});
