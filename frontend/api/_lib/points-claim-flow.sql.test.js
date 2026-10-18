import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { claimParlayTicket, collectCycleParlayWinnings, listParlayTicketsForUser } from './points-parlays.js';
import { readParlayScoreRows } from './points-tournament-leaderboard.js';
import { snapshotCycleLeaderboard } from './points-cycle-snapshot.js';
import { collectCyclePositionWinnings, redeemWinningPosition } from './points-redemption.js';

const cycle = { id: 5, label: 'Torneo Octubre 2026',
  started_at: '2026-10-01T06:00:00Z', ends_at: '2026-11-01T05:59:59Z' };
const window = { id: 5, startsAt: cycle.started_at, rankingCutoffAt: cycle.ends_at };
const collection = { cycleId: 5, startIso: cycle.started_at, cutoffIso: cycle.ends_at };

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_cycles(id INT PRIMARY KEY,label TEXT,started_at TIMESTAMPTZ,ends_at TIMESTAMPTZ,status TEXT,closed_at TIMESTAMPTZ);
    INSERT INTO points_cycles VALUES(5,'Torneo Octubre 2026','2026-10-01T06:00Z','2026-11-01T05:59:59Z','active',NULL);
    CREATE TABLE points_users(username TEXT PRIMARY KEY,created_at TIMESTAMPTZ DEFAULT '2026-10-01T06:00Z',profile_image_url TEXT);
    CREATE TABLE points_balances(username TEXT PRIMARY KEY,balance NUMERIC(20,6),updated_at TIMESTAMPTZ);
    INSERT INTO points_users(username) VALUES('ana'),('ben');
    INSERT INTO points_balances VALUES('ana',900,NOW()),('ben',900,NOW());
    CREATE TABLE points_markets(id INT PRIMARY KEY,parent_id INT,mode TEXT DEFAULT 'points',created_at TIMESTAMPTZ DEFAULT '2026-10-02T06:00Z',
      tournament_featured BOOLEAN DEFAULT true,status TEXT,outcome INT,reserves JSONB DEFAULT '[1000,1000]',
      outcomes JSONB DEFAULT '["Yes","No"]',start_time TIMESTAMPTZ,end_time TIMESTAMPTZ,resolved_at TIMESTAMPTZ,resolver_config JSONB DEFAULT '{}');
    INSERT INTO points_markets(id,status,outcome,resolved_at) VALUES
      (1,'resolved',0,'2026-10-03T06:00Z'),(2,'resolved',1,'2026-10-03T06:00Z'),
      (3,'canceled',NULL,NULL),(4,'active',NULL,NULL),(5,'resolved',0,'2026-10-03T06:00Z');
    CREATE TABLE points_pending_markets(id INT,approved_market_id INT,reviewed_at TIMESTAMPTZ,source_data JSONB);
    CREATE TABLE points_positions(market_id INT,username TEXT,outcome_index INT,shares NUMERIC,cost_basis NUMERIC,
      realized_pnl NUMERIC DEFAULT 0,updated_at TIMESTAMPTZ,dismissed_at TIMESTAMPTZ,PRIMARY KEY(market_id,username,outcome_index));
    INSERT INTO points_positions(market_id,username,outcome_index,shares,cost_basis) VALUES(1,'ana',0,200,100),(1,'ben',1,100,100);
    CREATE TABLE points_trades(id SERIAL PRIMARY KEY,market_id INT,username TEXT,side TEXT,outcome_index INT,shares NUMERIC,
      collateral NUMERIC,fee NUMERIC DEFAULT 0,price_at_trade NUMERIC,source TEXT DEFAULT 'web',created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO points_trades(market_id,username,side,outcome_index,shares,collateral,price_at_trade,created_at) VALUES
      (1,'ana','buy',0,200,100,0.5,'2026-10-02T06:00Z'),(1,'ben','buy',1,100,100,1,'2026-10-02T06:00Z');
    CREATE TABLE points_parlay_tickets(id INT PRIMARY KEY,username TEXT,cycle_id INT DEFAULT 5,stake NUMERIC,multiplier NUMERIC DEFAULT 5,
      potential_payout NUMERIC,payout NUMERIC DEFAULT 0,status TEXT DEFAULT 'open',submitted_at TIMESTAMPTZ DEFAULT '2026-10-02T06:00Z',
      settled_at TIMESTAMPTZ,reason TEXT);
    INSERT INTO points_parlay_tickets(id,username,stake,potential_payout) VALUES
      (1,'ana',100,500),(2,'ben',100,700),(3,'ana',50,200),(4,'ana',100,300),(5,'ana',100,1000),(6,'ana',100,1000),(7,'ana',100,1000);
    UPDATE points_parlay_tickets SET submitted_at='2026-09-02T06:00Z',cycle_id=4 WHERE id=5;
    UPDATE points_parlay_tickets SET submitted_at='2026-11-02T06:00Z',cycle_id=6 WHERE id=6;
    CREATE TABLE points_parlay_legs(id SERIAL PRIMARY KEY,ticket_id INT,market_id INT,outcome_index INT,status TEXT DEFAULT 'open',
      price_snapshot NUMERIC DEFAULT 0.5,question_snapshot TEXT DEFAULT 'Question',outcome_label_snapshot TEXT DEFAULT 'Yes',
      market_end_time TIMESTAMPTZ,resolved_outcome INT,settled_at TIMESTAMPTZ);
    INSERT INTO points_parlay_legs(ticket_id,market_id,outcome_index) VALUES
      (1,1,0),(1,2,1),(1,5,0),(2,1,1),(2,2,1),(2,4,0),(3,3,0),(3,1,0),(4,4,0),(5,1,0),(6,1,0),(7,999,0);
    CREATE TABLE points_distributions(id SERIAL PRIMARY KEY,username TEXT,amount NUMERIC,kind TEXT,reference_id INT,reason TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE points_cycle_snapshots(cycle_id INT,username TEXT,final_balance NUMERIC,final_pnl NUMERIC,rank INT,
      tournament_score NUMERIC,market_pnl NUMERIC,current_position_value NUMERIC,hold_bonus NUMERIC,liquidity_reward NUMERIC,
      parlay_pnl NUMERIC,parlay_tickets INT,parlay_wins INT,conviction_bonus_gross NUMERIC,conviction_bonus_cap_applied NUMERIC,
      conviction_eligible_profit NUMERIC,conviction_markets INT,conviction_lots INT,inactivity_penalty NUMERIC,
      inactive_days INT,active_days INT,qualifying_markets INT,qualified BOOLEAN,PRIMARY KEY(cycle_id,username));
  `);
  return db;
}

async function scores(db) { return readParlayScoreRows(db, cycle.started_at, cycle.ends_at); }
async function balance(db, user = 'ana') { return Number((await db.query('SELECT balance FROM points_balances WHERE username=$1', [user])).rows[0].balance); }

test('reading tickets and ranking recognizes confirmed wins/losses without collecting money', async t => {
  const db = await fixture(t);
  const tickets = await listParlayTicketsForUser(db, { username: 'ana' });
  const won = tickets.find(ticket => ticket.id === 1);
  assert.equal(won.status, 'won');
  assert.equal(won.storedStatus, 'open');
  assert.equal(won.claimable, true);
  assert.equal(won.claimAmount, 500);
  assert.equal(won.scorePnl, 400);
  assert.equal(won.payout, 0);
  assert.ok(won.legs.every(leg => leg.status === 'won'));
  assert.equal(tickets.find(ticket => ticket.id === 7).status, 'open');
  assert.deepEqual((await scores(db)).sort((a,b) => a.username.localeCompare(b.username)), [
    { username: 'ana', parlay_pnl: 400, parlay_tickets: 3, parlay_wins: 1 },
    { username: 'ben', parlay_pnl: -100, parlay_tickets: 1, parlay_wins: 0 },
  ]);
  assert.equal(await balance(db), 900);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n, 0);
});

test('manual collection pays exactly once, checks ownership and cannot change ranking', async t => {
  const db = await fixture(t);
  const before = await scores(db);
  await assert.rejects(db.transaction(tx => claimParlayTicket(tx, { username: 'ben', ticketId: 1 })), { message: 'ticket_not_found' });
  const claims = await Promise.all([1, 2].map(() => db.transaction(tx => claimParlayTicket(tx, { username: 'ana', ticketId: 1 }))));
  assert.equal(claims.reduce((sum, claim) => sum + claim.payout, 0), 500);
  assert.equal(claims.filter(claim => claim.alreadyClaimed).length, 1);
  assert.equal(await balance(db), 1400);
  assert.deepEqual(await scores(db), before);
  assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM points_distributions WHERE kind='parlay_payout'")).rows[0].n, 1);
});

test('unresolved and other-cycle tickets cannot be claimed', async t => {
  const db = await fixture(t);
  for (const id of [4, 7]) await assert.rejects(db.transaction(tx => claimParlayTicket(tx, { username: 'ana', ticketId: id })), { message: 'ticket_not_resolved' });
  for (const id of [5, 6]) await assert.rejects(db.transaction(tx => claimParlayTicket(tx, { username: 'ana', ticketId: id })), { message: 'ticket_outside_current_cycle' });
  assert.equal(await balance(db), 900);
});

test('cutoff pays only confirmed current-cycle combinadas and refunds, once', async t => {
  const db = await fixture(t);
  const first = await db.transaction(tx => collectCycleParlayWinnings(tx, collection));
  assert.deepEqual(first, { collected: 3, payout: 550 });
  assert.equal(await balance(db), 1450);
  assert.equal(await balance(db, 'ben'), 900);
  assert.equal((await db.transaction(tx => collectCycleParlayWinnings(tx, collection))).payout, 0);
  const pending = (await db.query("SELECT id FROM points_parlay_tickets WHERE status='open' ORDER BY id")).rows.map(row => row.id);
  assert.deepEqual(pending, [4, 5, 6, 7]);
});

test('position collection pays current-cycle winners, never losing, unresolved or stale reset shares', async t => {
  const db = await fixture(t);
  await db.exec(`INSERT INTO points_positions(market_id,username,outcome_index,shares,cost_basis) VALUES(5,'ana',0,300,150),(4,'ana',0,100,50);
    INSERT INTO points_trades(market_id,username,side,outcome_index,shares,collateral,created_at) VALUES
    (5,'ana','buy',0,50,25,'2026-10-02T06:00Z'),(4,'ana','buy',0,100,50,'2026-10-02T06:00Z');`);
  const result = await db.transaction(tx => collectCyclePositionWinnings(tx, window));
  assert.deepEqual(result, { collected: 2, payout: 250 });
  assert.equal(await balance(db), 1150);
  await db.exec("UPDATE points_trades SET created_at='2026-11-01T06:00Z' WHERE side='redeem'");
  assert.deepEqual(await db.transaction(tx => collectCyclePositionWinnings(tx, window)), { collected: 0, payout: 0 });
  await assert.rejects(db.transaction(tx => redeemWinningPosition(tx, { username: 'ana', marketId: 5, outcomeIndex: 0, window })), { message: 'position_outside_current_cycle' });
  const positions = (await db.query('SELECT market_id,username,shares FROM points_positions ORDER BY market_id,username')).rows;
  assert.equal(Number(positions.find(p => p.market_id === 5).shares), 250);
  assert.equal(Number(positions.find(p => p.username === 'ben').shares), 100);
  assert.equal(Number(positions.find(p => p.market_id === 4).shares), 100);
});

test('snapshot collects confirmed cash before freezing and a second snapshot changes nothing', async t => {
  const db = await fixture(t);
  const frozen = await db.transaction(tx => snapshotCycleLeaderboard(tx, cycle, { now: new Date(cycle.ends_at) }));
  assert.equal(frozen.find(row => row.username === 'ana').finalBalance, 1650);
  assert.equal(frozen.find(row => row.username === 'ana').parlayPnl, 400);
  assert.equal(frozen.find(row => row.username === 'ana').totalActions, 0); // Frozen rows omit live activity counters.
  await db.exec("UPDATE points_markets SET status='resolved',outcome=0 WHERE id=4");
  const again = await db.transaction(tx => snapshotCycleLeaderboard(tx, cycle, { now: new Date(cycle.ends_at) }));
  assert.deepEqual(again, frozen);
  assert.equal(await balance(db), 1650);
  assert.equal((await db.query('SELECT status FROM points_parlay_tickets WHERE id=4')).rows[0].status, 'open');
});

test('a snapshot failure rolls back collections, ledgers and positions together', async t => {
  const db = await fixture(t);
  await assert.rejects(db.transaction(tx => snapshotCycleLeaderboard({
    query(sql, params) {
      if (sql.includes('INSERT INTO points_cycle_snapshots')) throw new Error('snapshot failed');
      return tx.query(sql, params);
    },
  }, cycle, { now: new Date(cycle.ends_at) })), /snapshot failed/);
  assert.equal(await balance(db), 900);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n, 0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_cycle_snapshots')).rows[0].n, 0);
  assert.equal((await db.query('SELECT status FROM points_parlay_tickets WHERE id=1')).rows[0].status, 'open');
  assert.equal(Number((await db.query("SELECT shares FROM points_positions WHERE username='ana' AND market_id=1")).rows[0].shares), 200);
});


test('Points cutoff collection leaves on-chain shares and balances untouched', async t => {
  const db = await fixture(t);
  await db.exec("UPDATE points_markets SET mode='onchain' WHERE id=1");
  await assert.rejects(db.transaction(tx => redeemWinningPosition(tx, {
    username: 'ana', marketId: 1, outcomeIndex: 0, window,
  })), { message: 'onchain_market_requires_protocol', status: 409 });
  assert.deepEqual(await db.transaction(tx => collectCyclePositionWinnings(tx, window)), { collected: 0, payout: 0 });
  assert.equal(await balance(db), 900);
  assert.equal(Number((await db.query("SELECT shares FROM points_positions WHERE market_id=1 AND username='ana'")).rows[0].shares), 200);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n, 0);
});
