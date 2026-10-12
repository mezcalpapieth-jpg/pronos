import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockData, validateFx } from './stock-data.js';
const now = Date.now();
const fx = { rate: '18.3', date: new Date(now - 86400000).toISOString().slice(0, 10), source: 'test' };
function cacheDb() {
  const stored = new Map();
  return { async query(sql, params) {
    if (sql.startsWith('SELECT')) return { rows: stored.has(params[0]) ? [stored.get(params[0])] : [] };
    stored.set(params[0], { payload: JSON.parse(params[1]), fetched_at: params[2] });
    return { rows: [] };
  } };
}
function provider(body) {
  if (body.type === 'metaAndAssetCtxs') return [{ universe: [{ name: 'xyz:AAPL', szDecimals: 3 }] }, [{ markPx: '100', prevDayPx: '99', dayNtlVlm: '1000' }]];
  if (body.type === 'l2Book') return { coin: 'xyz:AAPL', time: now, levels: [[{ px: '99', sz: '10' }], [{ px: '100', sz: '10' }]] };
  return [{ s: 'xyz:AAPL', i: body.req.interval, t: now - 3600000, c: '100' }, { s: 'xyz:TSLA', i: body.req.interval, t: now, c: '1' }];
}
test('allowlisted metadata joins by symbol; missing assets stay unavailable', async () => {
  let requests = 0;
  const data = createStockData(cacheDb(), { fetchFx: async () => fx, fetchInfo: async body => { requests++; return provider(body); }, now: () => now });
  const result = await data.assets();
  assert.equal(result.assets.length, 9);
  assert.equal(result.assets[0].priceMxn, 1830);
  assert.equal(result.assets[1].available, false);
  await Promise.all([data.assets(), data.assets()]);
  assert.equal(requests, 1);
  assert.equal((await data.book('AAPL')).levels[0][0].px, '99');
  await assert.rejects(data.book('UNKNOWN'), { code: 'stock_not_found' });
});
test('failed refresh may return stale valuations but never a tradable stale quote', async () => {
  let clock = now;
  let failed = false;
  const data = createStockData(cacheDb(), { fetchFx: async () => fx, fetchInfo: async body => {
    if (failed) throw Object.assign(new Error('outage'), { status: 503 });
    return provider(body);
  }, now: () => clock });
  await data.book('AAPL');
  clock += 11000; failed = true;
  assert.equal((await data.assets(true)).stale, true);
  await assert.rejects(data.book('AAPL'));
});
test('crossed, unordered, wrong-symbol and stale books cannot produce quotes', async () => {
  for (const change of [b => { b.coin = 'xyz:TSLA'; }, b => { b.time -= 10000; },
    b => { b.levels[0][0].px = '101'; }, b => { b.levels[1].push({ px: '98', sz: '1' }); }]) {
    const data = createStockData(cacheDb(), { fetchFx: async () => fx, fetchInfo: async body => {
      const result = provider(body); if (body.type === 'l2Book') change(result); return result;
    }, now: () => now });
    await assert.rejects(data.book('AAPL'), { code: 'stock_price_unavailable' });
  }
});
test('candle interval matches the selected range and rejects foreign symbols', async () => {
  const data = createStockData(cacheDb(), { fetchInfo: async body => {
    assert.equal(body.req.interval, '1h');
    assert.equal(body.req.endTime - body.req.startTime, 7 * 86400000);
    return provider(body);
  }, now: () => now });
  assert.equal((await data.candles('AAPL', '7D')).candles.length, 1);
});
test('FX accepts a recent business-day FIX, rejects missing, future and old dates', () => {
  assert.equal(validateFx(fx, now), fx);
  for (const date of [null, 'bad', '2026-02-30', new Date(now - 8 * 86400000).toISOString().slice(0, 10), new Date(now + 86400000).toISOString().slice(0, 10)]) {
    assert.throws(() => validateFx({ ...fx, date }, now), { code: 'stock_fx_unavailable' });
  }
  for (const rate of ['0', '-1', 'bad', null]) assert.throws(() => validateFx({ ...fx, rate }, now), { code: 'stock_fx_unavailable', status: 503 });
});
