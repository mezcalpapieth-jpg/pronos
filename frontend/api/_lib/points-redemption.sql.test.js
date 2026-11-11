import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { collectCyclePositionWinnings, redeemWinningPosition } from './points-redemption.js';
import { readActiveCycleWindow } from './points-cycle-window.js';
import { snapshotActiveCycleAtCutoff } from './points-cycle-snapshot.js';

const cutoff = '2026-11-02T05:59:59.000Z';
const beforeCutoff = '2026-11-01T20:00:00.000Z';
const afterCutoff = '2026-11-03T00:32:43.253Z';
const marketId = 407558;

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_cycles (id INT PRIMARY KEY, label TEXT, started_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ, status TEXT, closed_at TIMESTAMPTZ);
    CREATE TABLE points_markets (id INT PRIMARY KEY, status TEXT, outcome INT, mode TEXT DEFAULT 'points');
    CREATE TABLE points_positions (market_id INT, username TEXT, outcome_index INT,
      shares NUMERIC(20,6), cost_basis NUMERIC(20,6), realized_pnl NUMERIC(20,6) DEFAULT 0,
      dismissed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      PRIMARY KEY (market_id, username, outcome_index));
    CREATE TABLE points_trades (id SERIAL PRIMARY KEY, market_id INT, username TEXT,
      side TEXT, outcome_index INT, shares NUMERIC(20,6), collateral NUMERIC(20,6) DEFAULT 0,
      fee NUMERIC(20,6) DEFAULT 0, price_at_trade NUMERIC, source TEXT, api_key_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE points_balances (username TEXT PRIMARY KEY, balance NUMERIC(20,6),
      updated_at TIMESTAMPTZ);
    CREATE TABLE points_distributions (id SERIAL PRIMARY KEY, username TEXT,
      amount NUMERIC(20,6), kind TEXT, reference_id INT, reason TEXT);
    CREATE TABLE points_users (username TEXT PRIMARY KEY, profile_image_url TEXT);
    CREATE TABLE points_cycle_snapshots (cycle_id INT, username TEXT, final_balance NUMERIC,
      final_pnl NUMERIC, tournament_score NUMERIC, rank INT,
      PRIMARY KEY (cycle_id, username));
    INSERT INTO points_cycles VALUES
      (5, 'Torneo Octubre 2026', '2026-10-01T06:00:00Z', '${cutoff}', 'active', NULL);
    INSERT INTO points_markets(id,status,outcome) VALUES (${marketId}, 'resolved', 1);
    INSERT INTO points_cycle_snapshots VALUES (5, 'holder', 1485.7, -1002.95, -1002.95, 127);
  `);
  return db;
}

async function addPosition(db, {
  username = 'holder', shares, costBasis = 60, balance = 500, trades,
}) {
  await db.query(`INSERT INTO points_positions
    (market_id, username, outcome_index, shares, cost_basis)
    VALUES ($1, $2, 1, $3, $4)`, [marketId, username, shares, costBasis]);
  await db.query('INSERT INTO points_balances VALUES ($1, $2, NOW())', [username, balance]);
  for (const { side = 'buy', shares: quantity, at } of trades) {
    await db.query(`INSERT INTO points_trades
      (market_id, username, side, outcome_index, shares, created_at, source)
      VALUES ($1, $2, $3, 1, $4, $5, 'web')`, [marketId, username, side, quantity, at]);
  }
}

function claim(db, options = {}) {
  return db.transaction(client => redeemWinningPosition(client, {
    username: 'holder', marketId, outcomeIndex: 1, ...options,
  }));
}

test('a post-tournament winner can claim the full payout once with matching accounting', async t => {
  const db = await setup(t);
  await addPosition(db, {
    shares: 321.439313, costBasis: 185.7, balance: 1519.999162,
    trades: [{ shares: 321.439313, at: afterCutoff }],
  });
  const originalTrades = (await db.query('SELECT * FROM points_trades ORDER BY id')).rows;

  assert.deepEqual(await claim(db), {
    balance: 1841.438475, payout: 321.439313, shares: 321.439313,
  });
  const position = (await db.query('SELECT * FROM points_positions')).rows[0];
  assert.equal(position.shares, '0.000000');
  assert.equal(position.cost_basis, '0.000000');
  assert.equal(position.realized_pnl, '135.739313');
  assert.ok(position.dismissed_at);
  assert.deepEqual((await db.query('SELECT amount, kind, reference_id FROM points_distributions')).rows, [
    { amount: '321.439313', kind: 'redemption', reference_id: marketId },
  ]);
  assert.deepEqual((await db.query("SELECT shares, collateral, fee, source FROM points_trades WHERE side='redeem'")).rows, [
    { shares: '321.439313', collateral: '321.439313', fee: '0.000000', source: 'web' },
  ]);
  await assert.rejects(claim(db), { message: 'no_shares_to_redeem' });
  assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance, '1841.438475');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n, 1);
  assert.deepEqual((await db.query("SELECT * FROM points_trades WHERE side='buy' ORDER BY id")).rows, originalTrades);
});

test('manual claims include purchases on both sides of the cutoff and subtract sales and prior claims', async t => {
  const db = await setup(t);
  await addPosition(db, {
    shares: 100,
    trades: [
      { shares: 80, at: beforeCutoff },
      { shares: 70, at: afterCutoff },
      { side: 'sell', shares: 20, at: afterCutoff },
      { side: 'redeem', shares: 30, at: afterCutoff },
    ],
  });
  assert.equal((await claim(db)).payout, 100);
  await assert.rejects(claim(db), { message: 'no_shares_to_redeem' });
  assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance, '600.000000');
});

test('automatic snapshot collection preserves the cutoff and leaves later purchases claimable', async t => {
  const db = await setup(t);
  await addPosition(db, {
    shares: 350,
    trades: [
      { shares: 200, at: '2026-09-30T20:00:00Z' },
      { shares: 100, at: beforeCutoff },
      { shares: 50, at: afterCutoff },
    ],
  });
  await addPosition(db, {
    username: 'later', shares: 40, trades: [{ shares: 40, at: afterCutoff }],
  });
  const window = await readActiveCycleWindow(db);
  const collect = () => db.transaction(client => collectCyclePositionWinnings(client, window));
  assert.deepEqual(await collect(), { collected: 1, payout: 100 });
  assert.deepEqual(await collect(), { collected: 0, payout: 0 });
  const remainder = (await db.query("SELECT shares, dismissed_at FROM points_positions WHERE username='holder'")).rows[0];
  assert.equal(remainder.shares, '250.000000');
  assert.equal(remainder.dismissed_at, null);
  assert.equal((await claim(db)).payout, 50);
  assert.equal((await claim(db, { username: 'later' })).payout, 40);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM points_trades WHERE source='tournament_auto_claim'")).rows[0].n, 1);
});

test('manual redemption cannot pay holdings from before the scoring window', async t => {
  const db = await setup(t);
  await addPosition(db, {
    shares: 300, costBasis: 150,
    trades: [
      { shares: 200, at: '2026-10-01T12:00:00Z' },
      { shares: 100, at: afterCutoff },
    ],
  });
  assert.equal((await claim(db)).payout, 100);
  const remainder = (await db.query('SELECT shares, cost_basis, dismissed_at FROM points_positions')).rows[0];
  assert.equal(remainder.shares, '200.000000');
  assert.equal(remainder.cost_basis, '100.000000');
  assert.ok(remainder.dismissed_at);
  await assert.rejects(claim(db), { message: 'position_outside_current_cycle', status: 409 });
  assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance, '600.000000');
});

test('resetting to a new cycle stops old claims while new-cycle purchases remain redeemable', async t => {
  const db = await setup(t);
  await addPosition(db, { shares: 100, trades: [{ shares: 100, at: afterCutoff }] });
  await db.exec(`UPDATE points_cycles SET status='closed', closed_at='2026-11-04T06:00:00Z';
    INSERT INTO points_cycles VALUES
      (6, 'Next cycle', '2026-11-04T06:00:00Z', '2026-11-18T06:00:00Z', 'active', NULL);`);
  await assert.rejects(claim(db), { message: 'position_outside_current_cycle', status: 409 });
  await db.exec(`UPDATE points_positions SET shares=140;
    INSERT INTO points_trades (market_id, username, side, outcome_index, shares, created_at)
      VALUES (${marketId}, 'holder', 'buy', 1, 40, '2026-11-04T07:00:00Z');`);
  assert.equal((await claim(db)).payout, 40);
  assert.equal((await db.query('SELECT shares FROM points_positions')).rows[0].shares, '100.000000');
});

test('claims require an active cycle even after the tournament has ended', async t => {
  const db = await setup(t);
  await addPosition(db, { shares: 100, trades: [{ shares: 100, at: afterCutoff }] });
  await db.exec("UPDATE points_cycles SET status='closed'");
  await assert.rejects(claim(db), { message: 'no_active_cycle', status: 409 });
  assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance, '500.000000');
});

test('a ledger failure rolls back the wallet credit, position and redemption trade', async t => {
  const db = await setup(t);
  await addPosition(db, { shares: 100, trades: [{ shares: 100, at: afterCutoff }] });
  await assert.rejects(db.transaction(client => redeemWinningPosition({
    query(sql, params) {
      if (sql.includes('INSERT INTO points_distributions')) throw new Error('simulated ledger outage');
      return client.query(sql, params);
    },
  }, { username: 'holder', marketId, outcomeIndex: 1 })), /simulated ledger outage/);
  assert.equal((await db.query('SELECT balance FROM points_balances')).rows[0].balance, '500.000000');
  assert.equal((await db.query('SELECT shares FROM points_positions')).rows[0].shares, '100.000000');
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM points_trades WHERE side='redeem'")).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n, 0);
});

test('post-cutoff claims and repeated snapshot jobs leave frozen tournament standings unchanged', async t => {
  const db = await setup(t);
  await addPosition(db, { shares: 100, trades: [{ shares: 100, at: afterCutoff }] });
  const frozen = (await db.query('SELECT * FROM points_cycle_snapshots')).rows;
  await claim(db);
  const snapshot = await db.transaction(client => snapshotActiveCycleAtCutoff(client, {
    now: new Date('2026-11-03T16:00:00Z'),
  }));
  assert.equal(snapshot.skipped, 'already_snapshotted');
  assert.equal(new Date(snapshot.cutoffAt).toISOString(), cutoff);
  assert.equal(snapshot.snapshotted, 1);
  assert.equal(snapshot.winners[0].score, -1002.95);
  assert.deepEqual((await db.query('SELECT * FROM points_cycle_snapshots')).rows, frozen);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n, 1);
});
