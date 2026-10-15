import assert from 'node:assert/strict';
import test from 'node:test';
import { espnEventStatus } from './espn-event-status.js';
import { sportsTradeLock, assertSportsTradeAllowed } from './points-sports-trade-guard.js';
import { readEspnEvent } from './sports-results.js';
import { createLimitOrder, executeLimitOrderById } from './points-limit-orders.js';

const now = new Date('2026-10-15T20:00:00Z');
const cfg = { source: 'espn', shape: 'binary', leaguePath: 'baseball/mlb', eventId: '401908025', dateYmd: '2026-10-15' };
const market = { id: 1, status: 'active', start_time: '2026-10-15T17:00:00Z', end_time: '2099-10-15T22:00:00Z',
  resolver_type: 'sports_api', resolver_config: cfg, outcomes: ['Guardians', 'Rays'], reserves: [500, 500] };

function summary({ state = 'post', completed = true, name = 'STATUS_FINAL', home = '3', away = '2', period = 9 } = {}) {
  return { header: { id: cfg.eventId, competitions: [{ status: { period, type: { state, completed, name } },
    competitors: [{ homeAway: 'home', score: home, team: { name: 'Guardians' } },
      { homeAway: 'away', score: away, team: { name: 'Rays' } }] }] } };
}

test('only confirmed final status ends a game, never the inning, lead or post-state alone', () => {
  assert.equal(espnEventStatus({ period: 9, type: { state: 'in', completed: false } }).completed, false);
  assert.equal(espnEventStatus({ type: { state: 'post', completed: false } }).completed, false);
  assert.equal(espnEventStatus({ type: { state: 'post', completed: true, name: 'STATUS_SUSPENDED' } }).completed, false);
  assert.equal(espnEventStatus({ type: { state: 'post', completed: true, name: 'STATUS_FINAL' } }).completed, true);
});

test('finals including walk-offs, no bottom ninth, shortened games and extra innings block trading before scheduled close', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const period of [5, 8, 9, 12]) {
    globalThis.fetch = async (url, options) => {
      assert.match(String(url), /summary\?event=401908025$/);
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal);
      return { ok: true, json: async () => summary({ period }) };
    };
    assert.equal((await sportsTradeLock(market, { now }))?.error, 'market_closed');
    const result = await readEspnEvent({ ...cfg, preferSummary: true });
    assert.equal(result.completed, true);
    assert.equal(result.winner, 'home');
  }
});

test('live bottom ninth with either team leading and tied extra innings remain tradable', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const [home, away, period] of [['3', '2', 9], ['2', '3', 9], ['3', '3', 12]]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => summary({ state: 'in', completed: false, name: 'STATUS_IN_PROGRESS', home, away, period }) });
    assert.equal(await sportsTradeLock(market, { now }), null);
  }
});

test('missing, mismatched, blocked, invalid or failed event evidence fails closed without guessing a winner', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const invalid = summary({ home: null });
  const mismatch = summary(); mismatch.header.id = 'another-game';
  for (const body of [{}, mismatch, invalid, summary({ state: 'post', completed: false })]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => body });
    assert.equal((await sportsTradeLock(market, { now }))?.error, 'sports_status_unavailable');
  }
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  assert.equal((await sportsTradeLock(market, { now }))?.status, 503);
  globalThis.fetch = async () => { throw new Error('timeout'); };
  await assert.rejects(assertSportsTradeAllowed(market, { now }), { message: 'sports_status_unavailable', status: 503 });
});

test('interrupted games stop trading but cannot be automatically awarded to the current leader', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  for (const name of ['STATUS_SUSPENDED', 'STATUS_POSTPONED', 'STATUS_CANCELED', 'STATUS_DELAYED']) {
    globalThis.fetch = async () => ({ ok: true, json: async () => summary({ name }) });
    assert.equal((await sportsTradeLock(market, { now }))?.error, 'market_closed');
    assert.equal((await readEspnEvent({ ...cfg, preferSummary: true })).completed, false);
  }
});

test('unrelated markets and season-long contracts do not query live scores', async () => {
  const readEvent = () => { throw new Error('must not query'); };
  for (const row of [{ resolver_config: {} }, { resolver_config: { ...cfg, shape: 'parallel' } }]) {
    assert.equal(await sportsTradeLock(row, { now, readEvent }), null);
  }
  for (const shape of ['binary', 'draw3', 'total-goals-over']) {
    assert.equal((await sportsTradeLock({ ...market, resolver_config: JSON.stringify({ ...cfg, shape }) },
      { now, readEvent: async () => ({ completed: true, state: 'post' }) }))?.error, 'market_closed');
  }
});

test('provider status takes precedence over a stale future kickoff or missing start time', async () => {
  for (const start_time of ['2026-10-15T22:00:00Z', null]) {
    const row = { ...market, start_time };
    assert.equal((await sportsTradeLock(row, { now,
      readEvent: async () => ({ completed: true, state: 'post' }) }))?.error, 'market_closed');
    assert.equal(await sportsTradeLock(row, { now,
      readEvent: async () => ({ completed: false, state: 'pre' }) }), null);
  }
});

test('new and triggered limit orders cannot reserve or execute money after the final signal', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, json: async () => summary() });
  const queries = [];
  const order = { id: 10, market_id: 1, outcome_index: 0, side: 'buy', status: 'open', remaining_amount: 100,
    created_at: new Date().toISOString(), maker_reward_last_accrued_at: new Date().toISOString() };
  const client = { async query(sql) {
    queries.push(sql);
    if (sql.includes('FROM points_markets')) return { rows: [market] };
    if (sql.includes('FROM points_limit_orders')) return { rows: [order] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  await assert.rejects(createLimitOrder(client, { marketId: 1, username: 'user', side: 'buy', outcomeIndex: 0,
    limitPrice: 0.5, amount: 100 }), { message: 'market_closed' });
  const result = await executeLimitOrderById(client, 10);
  assert.equal(result.triggered, false);
  assert.equal(result.detail, 'market_closed');
  assert.ok(queries.every(sql => sql.trim().startsWith('SELECT')));
});
