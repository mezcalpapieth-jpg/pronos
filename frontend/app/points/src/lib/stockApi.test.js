import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePnlSeries } from './stockApi.js';
test('combined PnL carries both series forward, merges equal timestamps and handles stocks alone', () => {
  assert.deepEqual(mergePnlSeries([{ t: 10, v: 2 }, { t: 30, v: 8 }], [{ t: 20, v: -1 }, { t: 30, v: 4 }]),
    [{ t: 10, v: 2 }, { t: 20, v: 1 }, { t: 30, v: 12 }]);
  assert.deepEqual(mergePnlSeries([], [{ t: 20, v: -1 }]), [{ t: 20, v: -1 }]);
  assert.deepEqual(mergePnlSeries([{ t: 1, v: 5 }], [{ t: 100000, v: 2 }], 1, 100000000), [{ t: 100000, v: 7 }]);
});
