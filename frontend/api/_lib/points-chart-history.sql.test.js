import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { loadChartWindows } from './points-chart-windows.js';

const historySource = await readFile(new URL('../points/price-history.js', import.meta.url), 'utf8');
const activitySource = await readFile(new URL('../points/trade-activity.js', import.meta.url), 'utf8');
const cronSource = await readFile(new URL('../cron/points-snapshot-prices.js', import.meta.url), 'utf8');
const queries = source => [...source.matchAll(/\bsql`([\s\S]*?)`/g)].map(match => match[1]);

// Execute the exact endpoint SQL, including its template parameters, against
// Postgres. Source assertions alone cannot catch invalid aliases/projections.
function tag(db) {
  return async (strings, ...values) => (await db.query(
    strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values,
  )).rows;
}

function run(sql, query, bindings = {}) {
  return new Function('sql', ...Object.keys(bindings), `return sql\`${query}\`;`)(sql, ...Object.values(bindings));
}

test('closed chart SQL freezes prices/activity and retains the closing history after live retention passes', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const sql = tag(db);
  await db.exec(`
    CREATE TABLE points_markets (
      id INT PRIMARY KEY, parent_id INT, status TEXT DEFAULT 'active',
      end_time TIMESTAMPTZ, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW() - INTERVAL '200 days',
      outcome INT DEFAULT 0, outcomes JSONB DEFAULT '["A","B"]', reserves JSONB DEFAULT '[1000,1000]', amm_mode TEXT DEFAULT 'unified'
    );
    CREATE TABLE points_price_snapshots (
      id SERIAL PRIMARY KEY, market_id INT, prices JSONB, reserves JSONB, snapshotted_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE points_trades (
      id SERIAL PRIMARY KEY, market_id INT, username TEXT, side TEXT, outcome_index INT,
      price_at_trade NUMERIC, reserves_before JSONB, reserves_after JSONB, created_at TIMESTAMPTZ, collateral NUMERIC
    );
    INSERT INTO points_markets (id,status,end_time,resolved_at) VALUES
      (1,'resolved',NOW()-INTERVAL '90 days',NOW()-INTERVAL '89 days'),
      (2,'active',NOW()+INTERVAL '1 day',NULL),
      (3,'active',NOW()-INTERVAL '90 days',NULL),
      (4,'canceled',NOW()+INTERVAL '1 day',NOW()-INTERVAL '90 days'),
      (10,'resolved',NOW()-INTERVAL '90 days',NOW()-INTERVAL '89 days');
    INSERT INTO points_markets (id,parent_id,status,end_time,resolved_at,amm_mode) VALUES
      (11,10,'resolved',NOW()-INTERVAL '90 days',NOW()-INTERVAL '92 days','parallel'),
      (12,10,'active',NOW()-INTERVAL '90 days',NULL,'parallel'),
      (20,NULL,'active',NOW()+INTERVAL '1 day',NULL,'parallel'),
      (21,20,'active',NOW()+INTERVAL '1 day',NULL,'parallel');
    INSERT INTO points_price_snapshots (id,market_id,prices,snapshotted_at) VALUES
      (101,1,'[0.3,0.7]',NOW()-INTERVAL '170 days'),
      (102,1,'[0.4,0.6]',NOW()-INTERVAL '151 days'),
      (103,1,'[0.5,0.5]',NOW()-INTERVAL '90 days 2 hours'),
      (104,1,'[0.6,0.4]',NOW()-INTERVAL '90 days 1 hour'),
      (105,1,'[1,0]',NOW()-INTERVAL '89 days 23 hours'),
      (201,2,'[0.4,0.6]',NOW()-INTERVAL '61 days'),
      (202,2,'[0.5,0.5]',NOW()-INTERVAL '1 hour'),
      (301,3,'[0.7,0.3]',NOW()-INTERVAL '90 days 1 hour'),
      (401,4,'[0.2,0.8]',NOW()-INTERVAL '90 days 1 hour'),
      (1101,11,'[0.1,0.9]',NOW()-INTERVAL '93 days'),
      (1102,11,'[0,1]',NOW()-INTERVAL '91 days'),
      (1201,12,'[0.8,0.2]',NOW()-INTERVAL '90 days 1 hour');
    INSERT INTO points_trades (market_id,username,side,outcome_index,price_at_trade,reserves_before,reserves_after,created_at,collateral) VALUES
      (1,'buyer','buy',0,0.58,'[1000,1000]','[1000,1000]',NOW()-INTERVAL '90 days 90 minutes',100),
      (1,'seller','sell',1,0.42,'[1000,1000]','[1000,1000]',NOW()-INTERVAL '90 days 30 minutes',50),
      (1,'late','buy',0,1,'[1000,1000]','[1000,1000]',NOW()-INTERVAL '89 days',1000),
      (1,'treasury','buy',0,0.5,'[1000,1000]','[1000,1000]',NOW()-INTERVAL '90 days 1 hour',2000);
  `);
  const windows = await loadChartWindows(sql, [1, 2, 3, 4, 11, 12, 999], 48);
  const bindings = { windows, maxPoints: 20, outcomeIdx: 0, tradeRowCap: 240, PRONOS_TREASURY_USERNAME: 'treasury', bucketSeconds: 1800 };
  const [sampleQuery, boundaryQuery, tradeQuery] = queries(historySource);
  assert.equal(queries(historySource).length, 3);

  await t.test('sampled rows include settlement history while trade overlays exclude post-close activity', async () => {
    const samples = await run(sql, sampleQuery, bindings);
    assert.deepEqual(samples.filter(row => row.market_id === 1).map(row => row.id), [103,104,105]);
    assert.deepEqual(samples.filter(row => row.market_id === 2).map(row => row.id), [202]);
    assert.deepEqual(samples.filter(row => row.market_id === 3).map(row => row.id), [301]);
    assert.deepEqual(samples.filter(row => row.market_id === 4).map(row => row.id), [401]);
    assert.deepEqual(samples.filter(row => row.market_id === 11), []);
    const boundary = await run(sql, boundaryQuery, bindings);
    assert.deepEqual(boundary.find(row => row.market_id === 1).prices, [0.4,0.6]);
    assert.deepEqual(boundary.find(row => row.market_id === 11).prices, [0.1,0.9]);
    const trades = await run(sql, tradeQuery, bindings);
    assert.deepEqual(trades.map(row => row.username), ['buyer','seller']);
  });

  await t.test('all-outcome and individual activity queries preserve the same closed window', async () => {
    const [allQuery, outcomeQuery] = queries(activitySource);
    assert.equal(queries(activitySource).length, 2);
    const all = await run(sql, allQuery, bindings);
    assert.equal(all.reduce((sum,row) => sum + row.count, 0), 2);
    assert.equal(all.reduce((sum,row) => sum + Number(row.volume), 0), 150);
    const outcome = await run(sql, outcomeQuery, bindings);
    assert.equal(outcome.reduce((sum,row) => sum + row.count, 0), 1);
    assert.equal(Number(outcome[0].buy_volume), 100);
    assert.ok(all.every(row => new Date(row.bucket_at) <= new Date(windows.windows.find(w => w.id === row.market_id).end)));
    assert.ok(all.every(row => new Date(row.bucket_at) >= new Date(windows.windows.find(w => w.id === row.market_id).start)));
  });

  await t.test('hourly collector writes only open pools, not expired, canceled, resolved, or parallel containers', async () => {
    const [candidateQuery] = queries(cronSource);
    const candidates = await run(sql, candidateQuery);
    assert.deepEqual(candidates.map(row => row.id), [2,21]);
  });

  await t.test('retention keeps 60 closing days plus one anchor, rather than purging old finished charts', async () => {
    const purgeQuery = queries(cronSource).find(query => query.includes('WITH cutoffs'));
    assert.ok(purgeQuery);
    await run(sql, purgeQuery);
    const remaining = (await db.query('SELECT id FROM points_price_snapshots ORDER BY id')).rows.map(row => row.id);
    assert.deepEqual(remaining, [102,103,104,105,202,301,401,1101,1201]);
    assert.deepEqual((await run(sql, sampleQuery, bindings)).filter(row => row.market_id === 1).map(row => row.id), [103,104,105]);
    assert.deepEqual((await run(sql, boundaryQuery, bindings)).find(row => row.market_id === 1).prices, [0.4,0.6]);
  });
});
