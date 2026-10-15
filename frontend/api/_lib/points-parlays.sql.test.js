import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { settleOpenParlayTickets } from './points-parlays.js';

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE points_parlay_tickets(id INT PRIMARY KEY,username TEXT,stake NUMERIC(20,6),
    multiplier NUMERIC,potential_payout NUMERIC(20,6),status TEXT,payout NUMERIC(20,6) DEFAULT 0,
    reason TEXT,settled_at TIMESTAMPTZ,submitted_at TIMESTAMPTZ DEFAULT NOW());
    CREATE TABLE points_parlay_legs(id INT PRIMARY KEY,ticket_id INT,market_id INT,outcome_index INT,
    status TEXT DEFAULT 'open',resolved_outcome INT,settled_at TIMESTAMPTZ);
    CREATE TABLE points_markets(id INT PRIMARY KEY,status TEXT,outcome INT);
    CREATE TABLE points_balances(username TEXT PRIMARY KEY,balance NUMERIC(20,6),updated_at TIMESTAMPTZ);
    CREATE TABLE points_distributions(id SERIAL PRIMARY KEY,username TEXT,amount NUMERIC(20,6),
    kind TEXT,reference_id INT,reason TEXT);
    INSERT INTO points_balances VALUES('winner',900,NOW()),('loser',900,NOW()),('refund',800,NOW());
    INSERT INTO points_parlay_tickets(id,username,stake,multiplier,potential_payout,status) VALUES
    (86,'winner',100,25,2500,'open'),(88,'loser',100,7.39,739,'open'),(89,'refund',200,6,1200,'open');
    INSERT INTO points_markets VALUES(1,'resolved',0),(2,'resolved',1),(3,'resolved',0),(4,'canceled',NULL);
    INSERT INTO points_parlay_legs(id,ticket_id,market_id,outcome_index) VALUES
    (1,86,1,0),(2,86,2,1),(3,86,3,0),
    (4,88,1,0),(5,88,2,0),(6,88,3,0),
    (7,89,1,0),(8,89,2,1),(9,89,4,0);`);
  return db;
}

test('real SQL settles wins, losses and refunds once, with matching wallet and ledger credits', async t => {
  const db = await setup(t);
  const first = await db.transaction(tx => settleOpenParlayTickets(tx));
  assert.deepEqual(first, { checked: 3, progressed: 9, settled: 3, won: 1, lost: 1, void: 1, payout: 2700 });
  assert.equal((await db.transaction(tx => settleOpenParlayTickets(tx))).settled, 0);
  assert.deepEqual((await db.query('SELECT username,balance FROM points_balances ORDER BY username')).rows, [
    { username: 'loser', balance: '900.000000' }, { username: 'refund', balance: '1000.000000' },
    { username: 'winner', balance: '3400.000000' },
  ]);
  assert.deepEqual((await db.query('SELECT reference_id,kind,amount FROM points_distributions ORDER BY reference_id')).rows, [
    { reference_id: 86, kind: 'parlay_payout', amount: '2500.000000' },
    { reference_id: 89, kind: 'parlay_refund', amount: '200.000000' },
  ]);
});

test('a ledger failure rolls back the settlement status, leg progress and every wallet credit', async t => {
  const db = await setup(t);
  await assert.rejects(db.transaction(tx => settleOpenParlayTickets({
    query(sql, params) {
      if (sql.includes('INSERT INTO points_distributions')) throw new Error('simulated ledger outage');
      return tx.query(sql, params);
    },
  })), /simulated ledger outage/);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM points_parlay_tickets WHERE status='open'")).rows[0].count, 3);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM points_parlay_legs WHERE status='open'")).rows[0].count, 9);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM points_distributions')).rows[0].count, 0);
  assert.equal((await db.query("SELECT balance FROM points_balances WHERE username='winner'")).rows[0].balance, '900.000000');
});
