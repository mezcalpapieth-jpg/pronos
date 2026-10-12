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
  assert.equal(result.assets.length, 13);
  assert.equal(result.assets[0].priceMxn, 1830);
  assert.equal(result.assets[1].available, false);
  await Promise.all([data.assets(), data.assets()]);
  assert.equal(requests, 2);
  assert.equal((await data.book('AAPL')).levels[0][0].px, '99');
  await assert.rejects(data.book('UNKNOWN'), { code: 'stock_not_found' });
});
test('native crypto and xyz instruments use separate metadata, books and candle symbols', async () => {
  const calls = [];
  const data = createStockData(cacheDb(), { fetchFx: async () => fx, now: () => now, fetchInfo: async body => {
    calls.push(body);
    if (body.type === 'metaAndAssetCtxs') return body.dex === ''
      ? [{ universe: [{ name: 'BTC', szDecimals: 5 }, { name: 'ETH', szDecimals: 4 }, { name: 'SOL', szDecimals: 2, isDelisted: true }] },
        [{ markPx: '110000', prevDayPx: '100000' }, { markPx: '4000', prevDayPx: '3900' }, { markPx: '190' }]]
      : [{ universe: [{ name: 'xyz:SPCX', szDecimals: 2 }, { name: 'BTC', szDecimals: 5 }] },
        [{ markPx: '164.5', prevDayPx: '160' }, { markPx: '1' }]];
    if (body.type === 'l2Book') return { coin: body.coin, time: now,
      levels: [[{ px: '100', sz: '10' }], [{ px: '101', sz: '10' }]] };
    return [{ s: body.req.coin, i: body.req.interval, t: now - 1000, T: now + 299000, c: '110001' }];
  } });
  const market = await data.assets();
  assert.equal(market.assets.find(a => a.ticker === 'BTC').priceUsd, '110000');
  assert.equal(market.assets.find(a => a.ticker === 'SPCX').priceUsd, '164.5');
  assert.equal(market.assets.find(a => a.ticker === 'SOL').available, false);
  assert.equal((await data.book('BTC')).szDecimals, 5);
  assert.equal((await data.book('SPCX')).szDecimals, 2);
  const chart = await data.candles('BTC', '4H');
  assert.equal(chart.candles[0].endTime, now + 299000);
  assert.deepEqual(calls.filter(c => c.type === 'l2Book').map(c => c.coin), ['BTC', 'xyz:SPCX']);
  assert.equal(calls.find(c => c.type === 'candleSnapshot').req.coin, 'BTC');
});
test('an unrelated venue outage does not block a current stock quote or detail prices', async () => {
  const data = createStockData(cacheDb(), { fetchFx: async () => fx, now: () => now, fetchInfo: async body => {
    if (body.type === 'metaAndAssetCtxs' && body.dex === '') throw new Error('native venue unavailable');
    return provider(body);
  } });
  const all = await data.assets();
  assert.equal(all.stale, true);
  assert.equal(all.assets.find(a => a.ticker === 'BTC').available, false);
  assert.equal((await data.assets(false, 'AAPL')).stale, false);
  assert.equal((await data.book('AAPL')).bookTime, now);
  await assert.rejects(data.assets(false, 'NOPE'), { code: 'stock_not_found' });
});
test('removed ETF is absent from the catalogue and cannot load prices or charts', async () => {
  const requests = [];
  const data = createStockData(cacheDb(), { fetchFx: async () => fx, now: () => now, fetchInfo: async body => {
    requests.push(body);
    return provider(body);
  } });
  const market = await data.assets();
  assert.equal(market.assets.length, 13);
  assert.equal(market.assets.some(asset => asset.ticker === 'SPYX' || asset.category === 'etfs'), false);
  assert.ok(requests.every(body => body.type === 'metaAndAssetCtxs'));
  await assert.rejects(data.assets(false, 'SPYX'), { code: 'stock_not_found' });
  await assert.rejects(data.book('SPYX'), { code: 'stock_not_found' });
  await assert.rejects(data.candles('SPYX', '4H'), { code: 'invalid_stock_chart' });
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
test('confirmation fetches a fresh book even while the indicative book cache is valid', async () => {
  let clock = now;
  let bookRequests = 0;
  const data = createStockData(cacheDb(), { fetchFx: async () => fx, fetchInfo: async body => {
    const result = provider(body);
    if (body.type === 'l2Book') { bookRequests++; result.time = clock; }
    return result;
  }, now: () => clock });
  assert.equal((await data.book('AAPL')).bookTime, now);
  clock += 2500;
  assert.equal((await data.book('AAPL')).bookTime, now);
  assert.equal(bookRequests, 1);
  assert.equal((await data.book('AAPL', { fresh: true })).bookTime, clock);
  assert.equal(bookRequests, 2);
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
test('every chart range preserves provider values and refreshes before the next 60-second UI poll', async () => {
  for (const [range, interval, durationMs] of [['4H', '5m', 14400000], ['24H', '15m', 86400000],
    ['7D', '1h', 604800000], ['30D', '4h', 2592000000], ['SPARK', '1h', 86400000]]) {
    let clock = now;
    let requests = 0;
    const data = createStockData(cacheDb(), { now: () => clock, fetchInfo: async body => {
      requests++;
      assert.equal(body.req.coin, 'xyz:NVDA');
      assert.equal(body.req.interval, interval);
      assert.equal(body.req.endTime - body.req.startTime, durationMs);
      return [{ s: 'xyz:NVDA', i: interval, t: now - 600000, c: '231.125' },
        { s: 'xyz:NVDA', i: '1m', t: now, c: '999' }];
    } });
    const result = await data.candles('NVDA', range);
    assert.equal(result.interval, interval);
    assert.deepEqual(result.candles, [{ t: now - 600000, close: 231.125 }]);
    clock += 54999;
    await data.candles('NVDA', range);
    assert.equal(requests, 1);
    clock += 2000;
    await data.candles('NVDA', range);
    assert.equal(requests, 2);
  }
});
test('FX accepts a recent business-day FIX, rejects missing, future and old dates', () => {
  assert.equal(validateFx(fx, now), fx);
  for (const date of [null, 'bad', '2026-02-30', new Date(now - 8 * 86400000).toISOString().slice(0, 10), new Date(now + 86400000).toISOString().slice(0, 10)]) {
    assert.throws(() => validateFx({ ...fx, date }, now), { code: 'stock_fx_unavailable' });
  }
  for (const rate of ['0', '-1', 'bad', null]) assert.throws(() => validateFx({ ...fx, rate }, now), { code: 'stock_fx_unavailable', status: 503 });
});

test('cutoff uses the exact completed minute and historical FIX, never a forming or substitute candle', async () => {
  const cutoffAt = Date.parse('2026-10-12T05:59:00Z');
  const candle = { s: 'xyz:NVDA', i: '1m', t: cutoffAt-60000, T: cutoffAt-1, c: '231.12' };
  const options = { now: () => cutoffAt+1000, fetchFxAt: async at => {
    assert.equal(at,cutoffAt); return { rate: '18.4163', date: '2026-10-09' };
  }, fetchInfo: async body => {
    assert.deepEqual(body.req, { coin: 'xyz:NVDA', interval: '1m', startTime: cutoffAt-60000, endTime: cutoffAt });
    return [candle, { ...candle, t: cutoffAt, T: cutoffAt+59999, c: '999' }];
  } };
  const result = await createStockData(cacheDb(),options).cutoff(['NVDA'],cutoffAt);
  assert.equal(result.assets[0].priceUsd,'231.12');
  assert.equal(result.assets[0].pricedAt,cutoffAt-1);
  for (const patch of [{s:'xyz:AAPL'}, {t:cutoffAt-120000}, {T:cutoffAt}, {c:'0'}]) {
    const data = createStockData(cacheDb(),{...options,fetchInfo:async()=>[{...candle,...patch}]});
    await assert.rejects(data.cutoff(['NVDA'],cutoffAt),{code:'stock_cutoff_price_unavailable'});
  }
  const futureFix = createStockData(cacheDb(),{...options,fetchFxAt:async()=>({rate:'18.4',date:'2026-10-12'})});
  await assert.rejects(futureFix.cutoff(['NVDA'],cutoffAt),{code:'stock_fx_unavailable'});
});
