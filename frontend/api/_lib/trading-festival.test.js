import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { parseHTML } from 'linkedom';
import { FESTIVAL_CHART_SETTLEMENT_MS, FESTIVAL_MINUTE, FESTIVAL_SCHEDULE, isFestivalBitcoin } from '../../shared/trading-festival.js';
import { cryptoTradeLock } from './points-crypto-trade-guard.js';
import { ensurePointsSchema } from './points-schema.js';
import { festivalChartRange, festivalFeedEnabled, readFestivalBoundary } from './trading-festival-feed.js';
import { readFestivalMarkets, recordFestivalChartBar, runTradingFestivalTick } from './trading-festival.js';

const production = { VERCEL_ENV: 'production', TRADING_FESTIVAL_ENABLED: '1' };

test('Friday Nasdaq replays the last 30 minutes at 16:05 CDMX', () => {
  const ndx = FESTIVAL_SCHEDULE.at(-1);
  assert.equal(ndx.key, 'ndx');
  assert.equal(ndx.startTime, '2026-11-13T22:05:00.000Z');
  assert.equal(ndx.endTime, '2026-11-13T22:35:00.000Z');
  assert.deepEqual(ndx.replay, { startTime: '2026-11-13T20:29:00.000Z', endTime: '2026-11-13T20:59:00.000Z' });

  assert.equal(Date.parse(ndx.endTime) - Date.parse(ndx.startTime), 30 * FESTIVAL_MINUTE);
  assert.equal(Date.parse(ndx.replay.endTime) - Date.parse(ndx.replay.startTime), 30 * FESTIVAL_MINUTE);
  assert.equal(festivalFeedEnabled(ndx), false);
});

test('the Vunelix wrapper advances Nasdaq once each show minute, including with controls hidden', t => {
  const slot = FESTIVAL_SCHEDULE.at(-1);
  const start = Date.parse(slot.startTime);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start - 15_000 });
  const html = readFileSync(new URL('../../festival-nasdaq-chart.html', import.meta.url), 'utf8');
  const { document } = parseHTML(html);
  const modal = document.createElement('div');
  modal.id = 'replayControlBarModal';
  modal.className = 'show';
  modal.innerHTML = `
    <div class="replay-time-display">Nov 13, 2026, 02:28 PM</div>
    <button class="replay-play-pause"><svg><polygon /></svg></button>
    <button data-tooltip-title="Step Forward (⌥ + ARROWRIGHT)"></button>
  `;
  document.body.append(modal);
  const time = modal.querySelector('.replay-time-display');
  const forward = modal.querySelector('[data-tooltip-title^="Step Forward"]');
  let steps = 0;
  forward.addEventListener('click', () => {
    steps += 1;
    time.textContent = `Nov 13, 2026, 02:${29 + steps} PM`;
  });
  const params = new URLSearchParams({
    asset: slot.key, showStart: slot.startTime, showEnd: slot.endTime,
    recordingStart: slot.replay.startTime, recordingEnd: slot.replay.endTime,
  });
  runInNewContext(document.querySelector('script').textContent, {
    document, window: { top: {}, self: {}, addEventListener() {} },
    location: { hostname: 'pronos-chi.vercel.app', search: params.toString() },
    Date, Intl, URLSearchParams, setTimeout, clearTimeout,
  });
  const clock = document.getElementById('replay-clock');
  const toggle = document.getElementById('replay-controls-toggle');
  const status = document.getElementById('replay-clock-status');
  clock.click();
  assert.match(status.textContent, /14:29/);
  assert.equal(steps, 0);

  time.textContent = 'Nov 13, 2026, 02:29 PM';
  clock.click();
  assert.match(status.textContent, /16:05/);
  toggle.click();
  assert.equal(toggle.textContent, 'Mostrar controles');
  assert.ok(document.body.hasAttribute('data-hide-replay-controls'));
  t.mock.timers.tick(15_000);
  assert.equal(steps, 0);

  for (let step = 1; step <= 30; step += 1) {
    t.mock.timers.tick(FESTIVAL_MINUTE - (step === 1 ? 0 : 250) - 1);
    assert.equal(steps, step - 1);
    t.mock.timers.tick(1);
    assert.equal(steps, step);
    t.mock.timers.tick(250);
  }
  assert.equal(Date.now(), Date.parse(slot.endTime) + 250);
  assert.equal(time.textContent, 'Nov 13, 2026, 02:59 PM');
  assert.equal(status.textContent, 'Replay finalizado');
  t.mock.timers.tick(FESTIVAL_MINUTE);
  assert.equal(steps, 30);
  toggle.click();
  assert.ok(!document.body.hasAttribute('data-hide-replay-controls'));
});

test('the SPX chart uses the market window and a lead-in', () => {
  const spx = FESTIVAL_SCHEDULE.find(slot => slot.key === 'spx');
  const end = Date.parse(spx.endTime);
  assert.equal(festivalChartRange(spx, end + FESTIVAL_MINUTE).to, end);
  const beforeFriday = Date.parse('2026-11-11T16:20:00Z');
  assert.deepEqual(festivalChartRange(spx, beforeFriday), {
    from: beforeFriday - 12 * FESTIVAL_MINUTE,
    to: beforeFriday,
  });
});

test('Coinbase uses the exact minute immediately before the boundary', async () => {
  const [btc] = FESTIVAL_SCHEDULE;
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

});

test('the Vunelix resolver relays the requested finished candle only', () => {
  const html = readFileSync(new URL('../../festival-nasdaq-chart.html', import.meta.url), 'utf8');
  const { document } = parseHTML(html);
  const slot = FESTIVAL_SCHEDULE.find(item => item.key === 'spx');
  assert.equal(festivalFeedEnabled(slot), false);
  const barStart = Date.parse(slot.startTime) - FESTIVAL_MINUTE;
  const params = new URLSearchParams({ asset: slot.key, resolve: '1' });
  const messages = [];
  const parent = { postMessage: (...args) => messages.push(args) };
  const listeners = [];
  const window = { top: parent, self: {}, parent, addEventListener: (type, listener) => listeners.push(listener) };
  runInNewContext(document.querySelector('script').textContent, {
    document, window, location: { hostname: 'pronos-chi.vercel.app', search: params.toString() },
    Date, Intl, URLSearchParams, setTimeout, clearTimeout,
  });
  const chart = document.querySelector('vunelix-advanced-chart');
  chart._chart = {
    options: { symbol: 'SP:SPX', period: '1m' },
    engine: { data: [{ timestamp: barStart / 1000, close: 7501.2 }] },
  };
  const request = {
    source: parent, origin: 'https://pronos.io',
    data: { type: 'pronos:festival-chart-bar', barStart },
  };
  const send = event => listeners.forEach(listener => listener(event));
  send(request);
  assert.equal(messages.length, 0);
  chart._chart.engine.data.push({ timestamp: barStart / 1000 + 60, close: 7502.2 });
  send({ ...request, origin: 'https://example.com' });
  send({ ...request, source: {} });
  send({ ...request, data: { ...request.data, barStart: barStart - FESTIVAL_MINUTE } });
  chart._chart.options.symbol = 'NASDAQ:NDX';
  send(request);
  chart._chart.options.symbol = 'SP:SPX';
  chart._chart.options.period = '5m';
  send(request);
  assert.equal(messages.length, 0);
  chart._chart.options.period = '1m';
  send(request);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][1], request.origin);
  assert.deepEqual({ ...messages[0][0] }, {
    type: request.data.type, asset: 'spx', symbol: 'SP:SPX', barStart, price: 7501.2,
  });
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
  const [fridayBtc, spx, ndx] = FESTIVAL_SCHEDULE.slice(-3);
  const boundary = (slot, field) => Date.parse(slot[field]);
  const btcStart = boundary(btc, 'startTime');
  const btcClose = boundary(btc, 'endTime');
  const fxStart = boundary(fx, 'startTime');
  const fxClose = boundary(fx, 'endTime');
  const run = (now, env = production) => runTradingFestivalTick({
    sql, env, clock: () => now, transaction: cb => db.transaction(cb),
    readBoundary: async (slot, { at }) => {
      assert.ok(isFestivalBitcoin(slot));
      return { t: at, price: at === boundary(slot, 'startTime') ? 74000 : 74001 };
    },
  });
  const record = (slot, at, price, now = at, overrides = {}) => recordFestivalChartBar({
    key: slot.key, symbol: slot.presentationTicker, barStart: at - FESTIVAL_MINUTE, price,
    actor: 'festival-admin', clock: () => now, transaction: cb => db.transaction(cb), ...overrides,
  });

  assert.equal(await run(btcStart - FESTIVAL_MINUTE, { ...production, VERCEL_ENV: 'preview' }), null);
  assert.deepEqual(await readFestivalMarkets(sql), []);
  await run(btcStart - FESTIVAL_MINUTE);
  await run(btcStart - FESTIVAL_MINUTE);
  const seeded = await readFestivalMarkets(sql);
  assert.deepEqual(seeded.map(row => row.source_event_id).sort(), ['btc', 'btc-fri', 'spx', 'usdmxn']);
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
  assert.equal(openFx.status, 'active');
  await assert.rejects(record(fx, fxStart, 18.92, fxStart - 1), /chart_market_not_ready/);
  await assert.rejects(record(fx, fxStart - FESTIVAL_MINUTE, 18.92), /invalid_chart_minute/);
  await assert.rejects(record(fx, fxStart, 18.92, fxStart, { symbol: spx.presentationTicker }), /invalid_chart_bar/);
  await run(fxClose);
  await assert.rejects(record(fx, fxClose, 18.92), /chart_open_missing/);
  // A collector restarted after close can still relay both finished candles.
  assert.deepEqual(await record(fx, fxStart, 18.92, fxClose), { status: 'active' });
  await assert.rejects(record(fx, fxStart, 19, fxClose), /chart_bar_already_recorded/);
  assert.deepEqual(await record(fx, fxClose, 18.92), { status: 'canceled' });
  assert.deepEqual(await record(fx, fxClose, 18.92), { status: 'canceled' });
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

  const spxStart = boundary(spx, 'startTime');
  const spxEnd = boundary(spx, 'endTime');
  assert.equal((await get(spx.key)).status, 'pending');
  await run(spxStart);
  const openSpx = await get(spx.key);
  assert.equal(openSpx.status, 'active');
  assert.equal(openSpx.resolver_config.threshold, undefined);
  await record(spx, spxStart, 7500, spxStart + 12 * FESTIVAL_MINUTE);
  assert.equal((await get(spx.key)).resolver_config.threshold, 7500);
  assert.equal(cryptoTradeLock(openSpx, spxEnd).error, 'market_expired');
  await assert.rejects(record(spx, spxEnd, 7499, spxEnd - 1), /chart_market_not_ready/);
  await run(spxEnd + 12 * FESTIVAL_MINUTE);
  assert.equal((await get(spx.key)).status, 'active');
  await record(spx, spxEnd, 7499, spxEnd + 12 * FESTIVAL_MINUTE);
  const settledSpx = await get(spx.key);
  assert.equal(settledSpx.status, 'resolved');
  assert.equal(settledSpx.outcome, 1);
  assert.equal(settledSpx.resolver_config.closePrice, 7499);
  assert.equal(settledSpx.resolver_config.closePriceSource, 'Vunelix');
  assert.equal(settledSpx.resolver_config.closePriceRecordedBy, 'festival-admin');
  await assert.rejects(record(ndx, boundary(ndx, 'startTime'), 7400), /invalid_chart_bar/);
  const tick = await run(boundary(ndx, 'startTime'));
  assert.deepEqual(tick.find(item => item.key === ndx.key), { key: ndx.key, status: 'presentation' });
  assert.equal(await get(ndx.key), undefined);

  await db.query('DELETE FROM points_markets WHERE id = $1', [openSpx.id]);
  await run(spxStart);
  await run(spxEnd + FESTIVAL_CHART_SETTLEMENT_MS - 1);
  assert.equal((await get(spx.key)).status, 'active');
  await run(spxEnd + FESTIVAL_CHART_SETTLEMENT_MS);
  const missing = await get(spx.key);
  assert.equal(missing.status, 'canceled');
  assert.equal(missing.resolver_config.cancelReason, 'festival_missing_open');
});
