import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { executePointsBuy, executePointsSell } from './points-trading-service.js';
import { previewHybridBuy, previewHybridSell } from './points-trade-router.js';

const source = await readFile(new URL('./points-trading-service.js', import.meta.url), 'utf8');

test('points trading slippage guards do not coerce omitted values to zero', () => {
  assert.match(source, /import \{ optionalFiniteNumber \} from '\.\/protocol-trade-guards\.js'/);
  assert.match(source, /const minShares = optionalFiniteNumber\(minSharesOut\);/);
  assert.match(source, /const maxPrice = optionalFiniteNumber\(maxAvgPrice\);/);
  assert.match(source, /const minOut = optionalFiniteNumber\(minCollateralOut\);/);

  assert.doesNotMatch(source, /Number\.isFinite\(Number\(minSharesOut\)\)/);
  assert.doesNotMatch(source, /Number\.isFinite\(Number\(maxAvgPrice\)\)/);
  assert.doesNotMatch(source, /Number\.isFinite\(Number\(minCollateralOut\)\)/);
});

// A strict ledger double exercises actual trade writes and transaction rollback.
// Triggered-order scheduling is tested separately in limit-orders.test.js.
function ledger({ reserves = [500, 500], orders = [], positions = [], tournament = false } = {}) {
  let state = {
    market: { id: 1, status: 'active', reserves, outcomes: reserves.map((_, i) => `Outcome ${i}`),
      tournament_featured: tournament, resolver_config: {}, end_time: null },
    balances: { taker: 5000, maker: 0 }, positions, orders,
    trades: [], snapshots: [], distributions: [],
  };
  const client = { async query(sql, values = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    const rows = items => ({ rows: structuredClone(items) });
    if (s.startsWith('SELECT')) {
      if (s.includes('FROM points_markets')) return rows([state.market]);
      if (s.includes('FROM points_cycles')) return rows([]);
      if (s.includes('FROM points_balances')) {
        const balance = state.balances[values[0]];
        return rows(balance == null ? [] : [{ balance }]);
      }
      if (s.includes('FROM points_positions')) {
        return rows(state.positions.filter(p => p.username === values[1]
          && (values[2] == null || p.outcome_index === values[2])));
      }
      if (s.includes('FROM points_limit_orders')) {
        if (s.includes('WHERE id = $1')) return rows(state.orders.filter(o => o.id === values[0]));
        if (s.includes('username <> $3')) {
          const side = s.includes("side = 'sell'") ? 'sell' : 'buy';
          return rows(state.orders.filter(o => o.side === side && o.status === 'open'
            && o.outcome_index === values[1] && o.username !== values[2]
            && (!o.expires_at || new Date(o.expires_at) > new Date())));
        }
        if (s.includes('username = $2')) return rows(state.orders.filter(o => o.side === 'sell'
          && o.status === 'open' && o.username === values[1] && o.outcome_index === values[2]));
        return rows([]);
      }
      if (s.includes('FROM points_trades')) return rows([]);
    }
    if (s.startsWith('UPDATE points_markets SET reserves')) {
      state.market.reserves = JSON.parse(values[0]);
    } else if (s.startsWith('UPDATE points_balances')) {
      state.balances[values[1]] = Number(values[0]);
    } else if (s.startsWith('INSERT INTO points_balances')) {
      state.balances[values[0]] = Number(values[1]);
    } else if (s.startsWith('INSERT INTO points_positions')) {
      const [, username, outcome, shares, cost] = values;
      let position = state.positions.find(p => p.username === username && p.outcome_index === outcome);
      if (!position) {
        position = { username, outcome_index: outcome, shares: 0, cost_basis: 0, realized_pnl: 0 };
        state.positions.push(position);
      }
      position.shares += shares;
      position.cost_basis += cost;
    } else if (s.startsWith('UPDATE points_positions')) {
      const [shares, cost, pnl, , username, outcome] = values;
      const position = state.positions.find(p => p.username === username && p.outcome_index === outcome);
      assert.ok(position, 'updated position exists');
      Object.assign(position, { shares, cost_basis: cost, realized_pnl: pnl });
    } else if (s.startsWith('INSERT INTO points_trades')) {
      const [marketId, username, side, outcome, shares, collateral, fee, price, before, after, source, apiKeyId] = values;
      state.trades.push({ marketId, username, side, outcome, shares, collateral, fee, price,
        before: JSON.parse(before), after: JSON.parse(after), source, apiKeyId });
    } else if (s.startsWith('INSERT INTO points_price_snapshots')) {
      state.snapshots.push(values);
    } else if (s.startsWith('INSERT INTO points_distributions')) {
      state.distributions.push(values);
    } else if (s.startsWith('UPDATE points_limit_orders') && s.includes('SET status = $2')) {
      const [id, status, remaining, collateral, shares, filledShares, filledCollateral, avgFillPrice] = values;
      const order = state.orders.find(o => o.id === id);
      Object.assign(order, { status, remaining_amount: remaining, reserved_collateral: collateral,
        reserved_shares: shares, filled_shares: filledShares, filled_collateral: filledCollateral, avg_fill_price: avgFillPrice });
    } else if (s.startsWith('UPDATE points_limit_orders') && s.includes("SET status = 'expired'")) {
      state.orders.find(o => o.id === values[0]).status = 'expired';
    } else {
      throw new Error(`Unhandled SQL: ${s}`);
    }
    return rows([]);
  } };
  return {
    get state() { return state; },
    async trade(side, args) {
      const before = structuredClone(state);
      try {
        return await (side === 'buy' ? executePointsBuy : executePointsSell)(client, {
          username: 'taker', marketId: 1, outcomeIndex: 0, ...args,
        });
      } catch (error) {
        state = before;
        throw error;
      }
    },
  };
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
const restingOrder = (side, price, amount) => ({
  id: 1, username: 'maker', side, outcome_index: 0, status: 'open',
  limit_price: price, remaining_amount: amount, created_at: new Date().toISOString(),
  reserved_shares: side === 'sell' ? amount : 0,
  reserved_collateral: side === 'buy' ? amount : 0,
});

test('actual execution closes the original two-sided profit loop with no treasury trades', async () => {
  const db = ledger({ tournament: true });
  const yes = await db.trade('buy', { collateral: 900 });
  const no = await db.trade('buy', { collateral: 500, outcomeIndex: 1 });
  await db.trade('sell', { shares: yes.sharesOut });
  await db.trade('sell', { shares: no.sharesOut, outcomeIndex: 1 });
  near(db.state.balances.taker, 4971.501294);
  assert.ok(db.state.positions.every(p => p.shares < 0.000001));
  assert.equal(db.state.trades.length, 4);
  assert.ok(db.state.trades.every(t => t.username === 'taker'));
  assert.equal(db.state.snapshots.length, 4);
});

test('actual AMM execution agrees with quotes and only loses the buy fee on immediate exit', async () => {
  for (const reserves of [[910, 90], [500, 500], [500, 750, 250], [500, 500, 500, 500]]) {
    const db = ledger({ reserves });
    const quote = previewHybridBuy([], { reserves, outcomeIndex: 0, collateral: 300 });
    const bought = await db.trade('buy', { collateral: 300, source: 'api', apiKeyId: 42 });
    near(bought.sharesOut, quote.sharesOut);
    near(bought.priceBefore, quote.priceBefore);
    near(bought.priceAfter, quote.priceAfter);
    near(bought.fee, quote.fee);
    const exitQuote = previewHybridSell([], { reserves: quote.reservesAfter, outcomeIndex: 0, shares: bought.sharesOut });
    const sold = await db.trade('sell', { shares: bought.sharesOut });
    near(sold.collateralOut, exitQuote.collateralOut);
    near(db.state.balances.taker, 5000 - bought.fee);
    near(sold.realizedPnl, -bought.fee);
    near(db.state.positions[0].cost_basis, 0);
    assert.equal(db.state.trades[0].source, 'api');
    assert.equal(db.state.trades[0].apiKeyId, 42);
  }
});

test('mixed buys transfer only escrowed seller shares and credit exactly the real book proceeds', async () => {
  const order = restingOrder('sell', 0.6, 50);
  const db = ledger({ orders: [order], positions: [
    { username: 'maker', outcome_index: 0, shares: 50, cost_basis: 25, realized_pnl: 0 },
  ] });
  const quote = previewHybridBuy([order], { reserves: [500, 500], outcomeIndex: 0, collateral: 300, username: 'taker' });
  const filled = await db.trade('buy', { collateral: 300 });
  near(filled.sharesOut, quote.sharesOut);
  near(filled.fee, quote.fee);
  assert.deepEqual(db.state.market.reserves, quote.reservesAfter);
  assert.equal(db.state.balances.maker, 30);
  assert.equal(db.state.balances.taker, 4700);
  assert.equal(db.state.orders[0].status, 'filled');
  assert.equal(db.state.orders[0].reserved_shares, 0);
  assert.equal(db.state.positions.find(p => p.username === 'maker').shares, 0);
  assert.deepEqual(filled.orderbookFills.map(f => f.source), ['limit']);
  for (let i = 1; i < db.state.trades.length; i++) {
    assert.deepEqual(db.state.trades[i].before, db.state.trades[i - 1].after);
  }
});

test('mixed sells consume funded bid collateral and do not debit the maker twice', async () => {
  const order = restingOrder('buy', 0.45, 10);
  const db = ledger({ orders: [order], positions: [
    { username: 'taker', outcome_index: 0, shares: 500, cost_basis: 250, realized_pnl: 0 },
  ] });
  const quote = previewHybridSell([order], { reserves: [500, 500], outcomeIndex: 0, shares: 500, username: 'taker' });
  const filled = await db.trade('sell', { shares: 500 });
  near(filled.collateralOut, quote.collateralOut);
  near(db.state.balances.taker, 5000 + quote.collateralOut);
  assert.equal(db.state.balances.maker, 0);
  assert.equal(db.state.orders[0].reserved_collateral, 0);
  assert.equal(db.state.orders[0].status, 'filled');
  near(db.state.positions.find(p => p.username === 'maker').shares, quote.fills.find(f => f.source === 'limit').shares);
  near(db.state.positions.find(p => p.username === 'maker').cost_basis, 10);
  assert.deepEqual(db.state.market.reserves, quote.reservesAfter);
});

test('failed buy/sell slippage guards roll back every balance, position, order and reserve write', async () => {
  const db = ledger();
  let before = structuredClone(db.state);
  await assert.rejects(db.trade('buy', { collateral: 300, minSharesOut: 10000 }), { message: 'price_moved', status: 409 });
  assert.deepEqual(db.state, before);
  await assert.rejects(db.trade('buy', { collateral: 300, maxAvgPrice: 0.01 }), { message: 'price_moved', status: 409 });
  assert.deepEqual(db.state, before);
  const bought = await db.trade('buy', { collateral: 300 });
  before = structuredClone(db.state);
  await assert.rejects(db.trade('sell', { shares: bought.sharesOut, minCollateralOut: 1000 }), { message: 'price_moved', status: 409 });
  assert.deepEqual(db.state, before);
});

test('tournament share caps remain enforced on AMM-only routing', async () => {
  const db = ledger({ tournament: true });
  db.state.balances.taker = 20000;
  const before = structuredClone(db.state);
  await assert.rejects(db.trade('buy', { collateral: 10000 }), { message: 'tournament_share_cap', status: 400 });
  assert.deepEqual(db.state, before);
});

test('partial fills transfer only filled shares and preserve the remaining ask escrow', async () => {
  const order = restingOrder('sell', 0.51, 1000);
  const db = ledger({ orders: [order], positions: [
    { username: 'maker', outcome_index: 0, shares: 1000, cost_basis: 500, realized_pnl: 0 },
  ] });
  const result = await db.trade('buy', { collateral: 100 });
  assert.equal(result.fee, 0);
  assert.deepEqual(db.state.market.reserves, [500, 500]);
  assert.equal(db.state.orders[0].status, 'open');
  near(db.state.orders[0].remaining_amount, 1000 - result.sharesOut);
  near(db.state.orders[0].reserved_shares, 1000 - result.sharesOut);
  near(db.state.balances.maker, 100);
  assert.equal(db.state.trades.length, 2);
});

test('execution excludes own orders and does not sell shares reserved in an existing ask', async () => {
  const order = { ...restingOrder('sell', 0.01, 50), username: 'taker' };
  const db = ledger({ orders: [order], positions: [
    { username: 'taker', outcome_index: 0, shares: 50, cost_basis: 25, realized_pnl: 0 },
  ] });
  const bought = await db.trade('buy', { collateral: 100 });
  assert.equal(bought.orderbookFills.length, 0);
  assert.equal(db.state.orders[0].remaining_amount, 50);
  const before = structuredClone(db.state);
  await assert.rejects(db.trade('sell', { shares: 50 + bought.sharesOut }), { message: 'insufficient_available_shares' });
  assert.deepEqual(db.state, before);
});

test('invalid reserve quotes remain a client error and leave the ledger untouched', async () => {
  const db = ledger({ reserves: [0, 500] });
  const before = structuredClone(db.state);
  await assert.rejects(db.trade('buy', { collateral: 100 }), { message: 'invalid_quote', status: 400 });
  assert.deepEqual(db.state, before);
});
