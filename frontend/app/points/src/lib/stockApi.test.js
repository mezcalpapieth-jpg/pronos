import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePnlSeries, stockErrorMessage } from './stockApi.js';
test('combined PnL carries both series forward, merges equal timestamps and handles stocks alone', () => {
  assert.deepEqual(mergePnlSeries([{ t: 10, v: 2 }, { t: 30, v: 8 }], [{ t: 20, v: -1 }, { t: 30, v: 4 }]),
    [{ t: 10, v: 2 }, { t: 20, v: 1 }, { t: 30, v: 12 }]);
  assert.deepEqual(mergePnlSeries([], [{ t: 20, v: -1 }]), [{ t: 20, v: -1 }]);
  assert.deepEqual(mergePnlSeries([{ t: 1, v: 5 }], [{ t: 100000, v: 2 }], 1, 100000000), [{ t: 100000, v: 7 }]);
});

test('quote loading timeouts explain that another attempt needs no page refresh', () => {
  const error = new DOMException('The operation timed out', 'TimeoutError');
  assert.equal(stockErrorMessage(error), 'La carga tardó demasiado. Intenta otra vez sin recargar la página.');
  assert.equal(stockErrorMessage(error, 'en'), 'Loading took too long. Try again without refreshing the page.');
  assert.equal(stockErrorMessage({ code: 'stock_quote_expired' }), 'La cotización expiró. Solicita una nueva.');
});
