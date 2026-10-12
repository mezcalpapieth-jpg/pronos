import test from 'node:test';
import assert from 'node:assert/strict';
import { stockHandler } from './stock-http.js';
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
}
test('stock endpoints default off and reject the wrong method before database access', async () => {
  const original = process.env.POINTS_STOCKS_ENABLED;
  delete process.env.POINTS_STOCKS_ENABLED;
  try {
    const disabled = response();
    await stockHandler('assets')({ method: 'GET', headers: {} }, disabled);
    assert.equal(disabled.statusCode, 404);
    assert.equal(disabled.body.error, 'stocks_disabled');
    assert.equal(disabled.headers['Cache-Control'], 'private, no-store');
    const wrong = response();
    await stockHandler('buy')({ method: 'GET', headers: {} }, wrong);
    assert.equal(wrong.statusCode, 405);
  } finally { if (original == null) delete process.env.POINTS_STOCKS_ENABLED; else process.env.POINTS_STOCKS_ENABLED = original; }
});
test('enabled trading and portfolios require authentication and reject cross-origin mutations', async () => {
  const original = process.env.POINTS_STOCKS_ENABLED;
  process.env.POINTS_STOCKS_ENABLED = 'true';
  try {
    for (const action of ['quote', 'buy', 'sell', 'positions']) {
      const res = response();
      await stockHandler(action)({ method: action === 'positions' ? 'GET' : 'POST', headers: {} }, res);
      assert.equal(res.statusCode, 401);
    }
    const denied = response();
    await stockHandler('buy')({ method: 'POST', headers: { origin: 'https://evil.example', host: 'pronos.io', 'x-forwarded-proto': 'https' } }, denied);
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.body.error, 'cross_origin_state_change');
  } finally { if (original == null) delete process.env.POINTS_STOCKS_ENABLED; else process.env.POINTS_STOCKS_ENABLED = original; }
});

test('the trading kill switch blocks all stock writes while keeping authenticated reads enabled', async () => {
  const enabled = process.env.POINTS_STOCKS_ENABLED;
  const trading = process.env.POINTS_STOCKS_TRADING_ENABLED;
  process.env.POINTS_STOCKS_ENABLED = 'true';
  process.env.POINTS_STOCKS_TRADING_ENABLED = 'false';
  try {
    for (const action of ['quote', 'buy', 'sell']) {
      const res = response();
      await stockHandler(action)({ method: 'POST', headers: {} }, res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.error, 'stock_trading_paused');
    }
    const read = response();
    await stockHandler('positions')({ method: 'GET', headers: {} }, read);
    assert.equal(read.statusCode, 401);
  } finally {
    for (const [key,value] of [['POINTS_STOCKS_ENABLED',enabled],['POINTS_STOCKS_TRADING_ENABLED',trading]]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
});
