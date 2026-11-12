import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLiveSeedState } from './demoLiveSeed.js';

const MINUTE = 60_000;
const START = Date.parse('2026-11-12T13:00:00-06:00');

function market(id, endTime, extra = {}) {
  return {
    id,
    question: `Market ${id}`,
    category: 'finanzas',
    status: 'active',
    outcomes: ['Sí', 'No'],
    prices: [0.5, 0.5],
    endTime,
    ...extra,
  };
}

test('presentation trades rotate all eligible November markets at one fill per minute', async t => {
  let now = START;
  t.mock.method(Date, 'now', () => now);
  const storage = new Map();
  const timers = new Map();
  const refreshes = [];
  let nextTimer = 0;
  t.mock.method(Math, 'random', () => 0.99);
  globalThis.window = {
    document: { visibilityState: 'visible' },
    location: { origin: 'https://pronos.test' },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    sessionStorage: { getItem: key => ['pronos-demo-live-seed', 'pronos-festival-demo'].includes(key) ? '1' : null },
    setInterval: (fn, ms) => {
      const id = ++nextTimer;
      timers.set(id, { fn, ms });
      return id;
    },
    clearInterval: id => timers.delete(id),
    dispatchEvent: event => refreshes.push(event.detail),
  };
  const tick = () => [...timers.values()].find(timer => timer.ms === 1000)?.fn();

  const novemberClose = '2026-11-30T23:59:59-06:00';
  const eligible = [
    market(1, new Date(START + 7 * MINUTE).toISOString()),
    market(2, novemberClose, { outcomes: ['A', 'B', 'C'], prices: [0.3, 0.3, 0.4] }),
    ...[3, 4, 5, 6, 7, 8].map(id => market(id, novemberClose)),
  ];
  const active = [
    market(20, '2026-12-01T00:00:00-06:00'),
    market(21, novemberClose, { startTime: '2026-11-14T13:00:00-06:00' }),
    market(22, new Date(START - 1).toISOString()),
    ...eligible,
  ];
  const seed = await buildLiveSeedState({
    now,
    fetchImpl: async url => ({
      ok: true,
      json: async () => ({ markets: url.includes('status=active') ? active : [market(23, novemberClose, { status: 'resolved' })] }),
    }),
  });
  const { initDemoStore, updateDemoSettings } = await import('./demoStore.js');
  const { routeDemoRequest } = await import('./demoBackend.js');
  const state = initDemoStore(seed);
  const first = state.markets.find(row => row.id === 1);
  const openingPrices = [...first.prices];
  const initialVolume = first.tradeVolume;

  tick();
  assert.equal(first.endTime, eligible[0].endTime);
  assert.equal(state.recentTrades.length, 1);
  assert.equal(state.recentTrades[0].size, 2000);
  assert.equal(first.tradeVolume, initialVolume + 2000);
  assert.notDeepEqual(first.prices, openingPrices);
  assert.deepEqual(refreshes, [{ source: 'presentation_trade', marketId: 1 }]);
  const { history } = routeDemoRequest('/api/points/price-history?ids=1', 'GET').body;
  assert.equal(history[1].at(-1).p, Number((first.prices[0] * 100).toFixed(1)));
  const { tape } = routeDemoRequest('/api/points/trade-tape?ids=1,2', 'GET').body;
  assert.equal(tape[1].length, 1);
  assert.equal(tape[1][0].collateral, 2000);
  assert.notEqual(tape[1][0].priceBefore, tape[1][0].priceAfter);
  assert.deepEqual(tape[2], []);

  now += MINUTE - 1;
  tick();
  assert.equal(state.recentTrades.length, 1);
  const pricesAfterFirst = [...first.prices];
  Math.random.mock.mockImplementation(() => 0);
  for (let i = 1; i <= eligible.length; i += 1) {
    now = START + i * MINUTE;
    tick();
    tick();
  }
  assert.deepEqual(state.recentTrades.map(trade => trade.marketId), [1, 2, 3, 4, 5, 6, 7, 8, 2]);
  assert.deepEqual(first.prices, pricesAfterFirst);
  assert.equal(state.recentTrades[1].size, 100);
  assert.ok(state.recentTrades.every(({ size, username }) => size >= 100 && size <= 2000 && size % 100 === 0 && username.startsWith('demo_')));
  assert.equal(new Set(state.recentTrades.slice(0, 7).map(trade => trade.username)).size, 7);

  updateDemoSettings({ tradeFlowEnabled: false });
  now += 2 * MINUTE;
  tick();
  assert.equal(state.recentTrades.length, 9);
  updateDemoSettings({ tradeFlowEnabled: true });
  tick();
  tick();
  assert.equal(state.recentTrades.length, 10);

  // A reload restores the last fill and does not trade again inside that minute.
  timers.clear();
  const { initDemoStore: reload } = await import('./demoStore.js?reload');
  const reloaded = reload(seed);
  tick();
  assert.equal(reloaded.recentTrades.length, 10);
  now += MINUTE;
  tick();
  assert.equal(reloaded.recentTrades.length, 11);
  assert.equal(reloaded.recentTrades.at(-1).marketId, 4);
});
