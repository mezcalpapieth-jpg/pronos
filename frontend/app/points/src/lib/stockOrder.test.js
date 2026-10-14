import test from 'node:test';
import assert from 'node:assert/strict';
import { stockFormRequest, stockQuantityAtPercent, stockSalePercent } from './stockOrder.js';

test('percentage sales round down without creating or overselling units', () => {
  assert.equal(stockQuantityAtPercent('0.000320000000000000', 25, 5), '0.00008');
  assert.equal(stockQuantityAtPercent('0.00032', 50, 5), '0.00016');
  assert.equal(stockQuantityAtPercent('0.123456789', 75, 5), '0.09259');
  assert.equal(stockQuantityAtPercent('3', 25, 0), '0');
  assert.equal(stockQuantityAtPercent('0.00032', 0, 5), '0');
  assert.throws(() => stockQuantityAtPercent('1', 101, 5));
});

test('slider requests use quantity or sell-all, independently of the displayed money amount', () => {
  const form = { ticker: 'BTC', side: 'sell', unitMode: 'money', amount: '500', positionQuantity: '0.00032', precision: 5 };
  assert.deepEqual(stockFormRequest({ ...form, sellPercent: 100 }), { ticker: 'BTC', side: 'sell', sellAll: true });
  assert.deepEqual(stockFormRequest({ ...form, sellPercent: 50 }), { ticker: 'BTC', side: 'sell', quantity: '0.00016' });
  assert.deepEqual(stockFormRequest(form), { ticker: 'BTC', side: 'sell', amount: '500' });
});

test('both sides accept explicit units, and decimal commas are normalized', () => {
  for (const side of ['buy', 'sell']) {
    assert.deepEqual(stockFormRequest({ ticker: 'AAPL', side, unitMode: 'units', quantity: ' 0,25 ' }), { ticker: 'AAPL', side, quantity: '0.25' });
    assert.deepEqual(stockFormRequest({ ticker: 'AAPL', side, unitMode: 'money', amount: '100,50' }), { ticker: 'AAPL', side, amount: '100.50' });
  }
  assert.equal(stockSalePercent('0.00016', '0.00032'), 50);
  assert.equal(stockSalePercent('0.00033', '0.00032'), 100);
  assert.equal(stockSalePercent('', '0.00032'), 0);
});
