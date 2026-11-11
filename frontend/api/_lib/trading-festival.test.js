import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { FESTIVAL_MINUTE, FESTIVAL_SCHEDULE, isFestivalBitcoin } from '../../shared/trading-festival.js';
import { cryptoTradeLock } from './points-crypto-trade-guard.js';
import { ensurePointsSchema } from './points-schema.js';
import { festivalChartRange, festivalFeedEnabled, festivalSchedule, readFestivalBoundary } from './trading-festival-feed.js';
import { readFestivalMarkets, runTradingFestivalTick } from './trading-festival.js';

const production = { VERCEL_ENV: 'production', TRADING_FESTIVAL_ENABLED: '1' };
const licensed = {
  ...production,
  MASSIVE_API_KEY: 'test-key',
  TRADING_FESTIVAL_MASSIVE_SYMBOLS: 'usdmxn,ndx',
};

test('the Nasdaq cash index requires a full 30-minute regular session window', () => {
  const ndx = env => festivalSchedule(env).find(slot => slot.key === 'ndx');
  assert.equal(ndx(licensed).requiresReschedule, true);
  assert.equal(ndx({ ...licensed, TRADING_FESTIVAL_NDX_START: '2026-11-13T14:31:00-06:00' }).requiresReschedule, true);
  assert.equal(ndx({ ...licensed, TRADING_FESTIVAL_NDX_START: '2026-11-13T14:30:00' }).requiresReschedule, true);
  const moved = ndx({ ...licensed, TRADING_FESTIVAL_NDX_START: '2026-11-13T14:30:00-06:00' });
  assert.equal(moved.requiresReschedule, false);
  assert.equal(moved.endTime, '2026-11-13T21:00:00.000Z');
  assert.equal(festivalChartRange(ndx(licensed), Date.parse(ndx(licensed).endTime)).to, Date.parse(moved.endTime));
  const beforeFriday = Date.parse('2026-11-11T16:20:00Z');
  assert.deepEqual(festivalChartRange(ndx(licensed), beforeFriday), {
    from: beforeFriday - 12 * FESTIVAL_MINUTE,
    to: beforeFriday,
  });
});

test('the same exact-minute bar is required for both Coinbase and Massive boundaries', async () => {
  const [btc, fx] = FESTIVAL_SCHEDULE;
  const fridayBtc = FESTIVAL_SCHEDULE.find(slot => slot.key === 'btc-fri');
  const at = Date.parse(btc.startTime);
  const response = data => ({ ok: true, json: async () => data });
  const noMatchingCandle = async () => response([
    [at / 1000, 0, 0, 0, 103],
    [(at - 2 * FESTIVAL_MINUTE) / 1000, 0, 0, 0, 97],
  ]);
  assert.equal(await readFestivalBoundary(btc, { at, fetchImpl: noMatchingCandle }), null);

  const candle = async () => response([[(at - FESTIVAL_MINUTE) / 1000, 0, 0, 0, 101]]);
  assert.deepEqual(await readFestivalBoundary(btc, { at, fetchImpl: candle }), { t: at, price: 101 });
  assert.ok(isFestivalBitcoin(fridayBtc));
  const fridayStart = Date.parse(fridayBtc.startTime);
  assert.deepEqual(await readFestivalBoundary(fridayBtc, {
    at: fridayStart,
    fetchImpl: async url => {
      assert.equal(url.pathname, '/products/BTC-USD/candles');
      return response([[(fridayStart - FESTIVAL_MINUTE) / 1000, 0, 0, 0, 102]]);
    },
  }), { t: fridayStart, price: 102 });

  const massive = async (url, { headers }) => {
    assert.equal(url.hostname, 'api.massive.com');
    assert.equal(url.pathname, `/v2/aggs/ticker/C:USDMXN/range/1/minute/${at - FESTIVAL_MINUTE}/${at - 1}`);
    assert.equal(headers.Authorization, 'Bearer test-key');
    return response({ status: 'OK', results: [{ t: at - FESTIVAL_MINUTE, c: 18.32 }, { t: at, c: 18.44 }] });
  };
  assert.deepEqual(await readFestivalBoundary(fx, { at, fetchImpl: massive, env: licensed }), { t: at, price: 18.32 });
  assert.deepEqual(await readFestivalBoundary(fx, {
    at, fetchImpl: massive, env: { ...licensed, MASSIVE_API_KEY: '', TRADING_FESTIVAL_MASSIVE_API_KEY: 'test-key' },
  }), { t: at, price: 18.32 });
  const delayed = async () => response({ status: 'DELAYED', results: [{ t: at - FESTIVAL_MINUTE, c: 18.32 }] });
  await assert.rejects(readFestivalBoundary(fx, { at, fetchImpl: delayed, env: licensed }), /festival_feed_delayed/);
});

test('the S&P 500 presentation never enables a settlement feed', () => {
  const spx = FESTIVAL_SCHEDULE.find(slot => slot.key === 'spx');
  assert.equal(spx.ticker, 'SP:SPX');
  assert.equal(festivalFeedEnabled(spx, { ...licensed, TRADING_FESTIVAL_MASSIVE_SYMBOLS: 'spx' }), false);
});

test('festival seed, activation, lock, settlement and tie refund use the Points schema', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await ensurePointsSchema({ query: async statement => (await db.query(statement)).rows });

  const sql = async (parts, ...values) => {
    const query = parts.reduce((text, part, index) => text + part + (index < values.length ? `$${index + 1}` : ''), '');
    return (await db.query(query, values)).rows;
  };
  const [btc, fx] = FESTIVAL_SCHEDULE;
  const fridayBtc = FESTIVAL_SCHEDULE.find(slot => slot.key === 'btc-fri');
  const boundary = (slot, field) => Date.parse(slot[field]);
  const btcStart = boundary(btc, 'startTime');
  const btcClose = boundary(btc, 'endTime');
  const fxStart = boundary(fx, 'startTime');
  const fxClose = boundary(fx, 'endTime');
  const run = (now, env = licensed) => runTradingFestivalTick({
    sql, env, clock: () => now, transaction: cb => db.transaction(cb),
    readBoundary: async (slot, { at }) => isFestivalBitcoin(slot)
      ? { t: at, price: at === boundary(slot, 'startTime') ? 74000 : 74001 }
      : { t: at, price: 18.92 },
  });

  assert.equal(await run(btcStart - FESTIVAL_MINUTE, { ...licensed, VERCEL_ENV: 'preview' }), null);
  assert.deepEqual(await readFestivalMarkets(sql), []);
  await run(btcStart - FESTIVAL_MINUTE);
  await run(btcStart - FESTIVAL_MINUTE);
  const seeded = await readFestivalMarkets(sql);
  assert.deepEqual(seeded.map(row => row.source_event_id).sort(), ['btc', 'btc-fri', 'usdmxn']);
  assert.ok(seeded.every(row => row.status === 'pending'));
  const get = async key => (await readFestivalMarkets(sql)).find(row => row.source_event_id === key);

  await run(btcStart);
  const openBtc = await get('btc');
  assert.equal(openBtc.status, 'active');
  assert.equal(openBtc.resolver_config.threshold, 74000);
  assert.equal(cryptoTradeLock(openBtc, btcClose - 1), null);
  assert.equal(cryptoTradeLock(openBtc, btcClose).error, 'market_expired');

  await run(btcClose);
  const resolvedBtc = await get('btc');
  assert.equal(resolvedBtc.status, 'resolved');
  assert.equal(resolvedBtc.outcome, 0);
  assert.equal(resolvedBtc.resolver_config.closePrice, 74001);
  assert.equal((await db.query('SELECT featured FROM points_markets WHERE id = $1', [openBtc.id])).rows[0].featured, true);

  await run(fxStart);
  const openFx = await get('usdmxn');
  await db.query("INSERT INTO points_positions (market_id, username, outcome_index, shares, cost_basis) VALUES ($1, 'attendee', 0, 100, 25)", [openFx.id]);
  await run(fxClose);
  await run(fxClose + FESTIVAL_MINUTE);
  const canceled = await get('usdmxn');
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.resolver_config.cancelReason, 'festival_tie');
  const { rows } = await db.query("SELECT balance FROM points_balances WHERE username = 'attendee'");
  assert.equal(Number(rows[0].balance), 25);

  await run(boundary(fridayBtc, 'startTime'));
  const openFridayBtc = await get(fridayBtc.key);
  assert.notEqual(openFridayBtc.id, openBtc.id);
  assert.equal(openFridayBtc.status, 'active');
  assert.equal(openFridayBtc.resolver_config.threshold, 74000);
  await run(boundary(fridayBtc, 'endTime'));
  assert.equal((await get(fridayBtc.key)).outcome, 0);
  assert.deepEqual(await get(btc.key), resolvedBtc);
});
