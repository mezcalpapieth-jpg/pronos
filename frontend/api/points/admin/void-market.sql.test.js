import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

process.env.DATABASE_URL ||= 'postgresql://test:test@localhost/test';
const { voidOneMarket } = await import('./void-market.js');

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_markets(id INT PRIMARY KEY,status TEXT,amm_mode TEXT,parent_id INT,
      outcome INT,resolved_at TIMESTAMPTZ,resolved_by TEXT,final_score TEXT);
    INSERT INTO points_markets(id,status,amm_mode,parent_id) VALUES
      (1,'active','parallel',NULL),(2,'active','parallel',1),(3,'active','parallel',1),
      (4,'active','unified',NULL);
    CREATE TABLE points_positions(market_id INT,username TEXT,outcome_index INT,shares NUMERIC,
      cost_basis NUMERIC,updated_at TIMESTAMPTZ,PRIMARY KEY(market_id,username,outcome_index));
    INSERT INTO points_positions VALUES
      (2,'ana',0,120,100,NOW()),(2,'ana',1,80,40,NOW()),(3,'ben',0,50,25,NOW()),
      (4,'ana',0,90,60,NOW());
    CREATE TABLE points_balances(username TEXT PRIMARY KEY,balance NUMERIC,updated_at TIMESTAMPTZ);
    INSERT INTO points_balances VALUES('ana',500,NOW());
    CREATE TABLE points_distributions(id SERIAL PRIMARY KEY,username TEXT,amount NUMERIC,kind TEXT,
      reference_id INT,reason TEXT);
    CREATE TABLE points_limit_orders(id INT,market_id INT,status TEXT);
  `);
  return db;
}

test('void refunds each composite-key position once and cancels only the selected family', async t => {
  const db = await fixture(t);
  assert.deepEqual(await db.transaction(tx => voidOneMarket(tx,1,'Nominados cambiaron','test-admin')),
    {refundedCount:3,refundedTotal:165});
  assert.deepEqual((await db.query('SELECT username,balance::text FROM points_balances ORDER BY username')).rows,
    [{username:'ana',balance:'640'},{username:'ben',balance:'25'}]);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_positions WHERE market_id IN(2,3) AND (shares<>0 OR cost_basis<>0)')).rows[0].n,0);
  assert.equal((await db.query('SELECT cost_basis::text FROM points_positions WHERE market_id=4')).rows[0].cost_basis,'60');
  assert.deepEqual((await db.query('SELECT id,status FROM points_markets ORDER BY id')).rows,
    [{id:1,status:'canceled'},{id:2,status:'canceled'},{id:3,status:'canceled'},{id:4,status:'active'}]);
  await assert.rejects(db.transaction(tx => voidOneMarket(tx,1,'Again','test-admin')), {message:'already_resolved'});
  assert.equal((await db.query("SELECT COUNT(*)::int AS n,SUM(amount)::text AS total FROM points_distributions WHERE kind='void_refund'")).rows[0].total,'165');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n,3);
});

test('failed refund rolls back cancellation, balances, and all earlier refund rows', async t => {
  const db = await fixture(t);
  await db.exec("ALTER TABLE points_distributions ADD CONSTRAINT reject_ben CHECK(username <> 'ben')");
  await assert.rejects(db.transaction(tx => voidOneMarket(tx,1,'Invalid field','test-admin')));
  assert.equal((await db.query("SELECT status FROM points_markets WHERE id=1")).rows[0].status,'active');
  assert.equal((await db.query("SELECT balance::text FROM points_balances WHERE username='ana'")).rows[0].balance,'500');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_distributions')).rows[0].n,0);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM points_positions WHERE market_id IN(2,3) AND shares>0')).rows[0].n,3);
});
