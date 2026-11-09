import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { loadChartWindows } from './points-chart-windows.js';
import {
  PRICE_HISTORY_EXECUTION_BUCKET_MS, displayTradePointsFromRows,
  missingOpeningTimestamp, openingPricePoint,
} from './points-price-history-display.js';

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
      outcome INT DEFAULT 0, outcomes JSONB DEFAULT '["A","B"]', reserves JSONB DEFAULT '[1000,1000]',
      amm_mode TEXT DEFAULT 'unified', mode TEXT DEFAULT 'points', seed_liquidities JSONB
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
  const bindings = {
    windows, maxPoints: 20, outcomeIdx: 0, tradeRowCap: 240, PRONOS_TREASURY_USERNAME: 'treasury', bucketSeconds: 1800,
    executionBucketInterval: `${PRICE_HISTORY_EXECUTION_BUCKET_MS} milliseconds`,
  };
  const [sampleQuery, boundaryQuery, tradeQuery, openingTradeQuery] = queries(historySource);
  assert.equal(queries(historySource).length, 4);

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

  await t.test('the opening burst respects each trading cutoff and excludes in-window executions', async () => {
    await db.exec(`
      INSERT INTO points_markets (id,status,end_time,resolved_at,outcomes) VALUES
        (30,'resolved','2026-11-01T12:55:00Z','2026-11-01T13:00:00.500Z','["A","B"]'),
        (31,'resolved','2026-11-01T11:59:00Z','2026-11-01T13:00:00.500Z','["A","B"]'),
        (32,'resolved','2026-11-01T12:55:00Z','2026-11-01T13:00:00.500Z','["A","B","C"]');
      INSERT INTO points_trades (id,market_id,username,side,outcome_index,price_at_trade,reserves_before,reserves_after,created_at) VALUES
        (101,30,'buyer','buy',0,0.40,'[50,50]','[50,50]','2026-11-01T11:59:58.000Z'),
        (102,30,'buyer','buy',0,0.63,'[50,50]','[50,50]','2026-11-01T12:00:00.100Z'),
        (103,30,'buyer','buy',0,0.60,'[50,50]','[45,55]','2026-11-01T12:00:00.200Z'),
        (104,30,'buyer','buy',0,0.72,'[45,55]','[45,55]','2026-11-01T12:00:00.500Z'),
        (105,31,'buyer','buy',0,0.34,'[50,50]','[50,50]','2026-11-01T11:59:00.000Z'),
        (106,31,'buyer','buy',0,0.80,'[50,50]','[50,50]','2026-11-01T11:59:00.100Z'),
        (107,30,'treasury','buy',0,0.90,'[50,50]','[50,50]','2026-11-01T12:00:00.300Z'),
        (108,32,'buyer','buy',0,0.93,'[50,50]','[50,50]','2026-11-01T12:00:00.300Z');
    `);
    const chartWindows = await loadChartWindows(sql, [30, 31, 32], 1);
    const rows = await run(sql, tradeQuery, { ...bindings, windows: chartWindows });
    const before = rows.filter(row => row.is_boundary);
    const inside = rows.filter(row => !row.is_boundary);
    assert.deepEqual(before.map(row => row.id), [102, 103, 105]);
    assert.deepEqual(inside.map(row => row.id), [104]);
    assert.deepEqual(displayTradePointsFromRows(before, 0).map(({ market_id, p }) => [market_id, p]), [[30, 55], [31, 34]]);
    assert.deepEqual(displayTradePointsFromRows(inside, 0).map(point => point.p), [72]);
  });

  await t.test('opening odds use saved seeds or pre-trade reserves and respect recorded boundary points', async () => {
    await db.exec(`
      INSERT INTO points_markets (id,created_at,status,end_time,resolved_at,seed_liquidities) VALUES
        (40,'2026-11-01T12:30:00.625Z','resolved','2026-11-01T13:00:00Z','2026-11-01T13:00:00.071Z','[30,70]'),
        (41,'2026-11-01T11:00:00Z','resolved','2026-11-01T13:00:00Z','2026-11-01T13:00:00.071Z','[50,50]'),
        (42,'2026-11-01T12:30:00.625Z','resolved','2026-11-01T13:00:00Z','2026-11-01T13:00:00.071Z',NULL);
      INSERT INTO points_trades (market_id,username,side,reserves_before,created_at) VALUES
        (40,'buyer','buy','[21.44,78.56]','2026-11-01T12:45:00Z'),
        (40,'buyer','buy','[10,90]','2026-11-01T12:50:00Z'),
        (41,'buyer','buy','[40,60]','2026-11-01T11:15:00Z');
    `);
    const { windows: openingWindows } = await loadChartWindows(sql, [40, 41, 42], 1);
    const candidates = openingWindows.map(window => ({ window }));
    const firstTrades = await run(sql, openingTradeQuery, { candidates });
    const trade = id => firstTrades.find(row => row.market_id === id);
    const fresh = openingWindows.find(window => window.id === 40);
    const freshOpening = new Date(fresh.openedAt).getTime() / 1000;
    assert.equal(missingOpeningTimestamp(fresh, []), freshOpening);
    assert.deepEqual(openingPricePoint(fresh, freshOpening, null, 0), { t: freshOpening, p: 70 });
    assert.deepEqual(openingPricePoint(fresh, freshOpening, trade(40), 0), { t: freshOpening, p: 78.56 });
    assert.deepEqual(openingPricePoint(fresh, freshOpening, trade(40), 1), { t: freshOpening, p: 21.44 });

    const older = openingWindows.find(window => window.id === 41);
    const windowStart = Date.parse(older.start) / 1000;
    assert.equal(missingOpeningTimestamp(older, [{ t: windowStart, p: 78.56 }]), null);
    assert.equal(openingPricePoint(older, windowStart, trade(41), 0), null);
    const legacy = openingWindows.find(window => window.id === 42);
    assert.equal(openingPricePoint(legacy, freshOpening, trade(42), 0), null);
    assert.deepEqual(openingPricePoint({
      ...legacy, outcomes: ['A', 'B', 'C'], seedReserves: [100, 200, 400],
    }, freshOpening, null, 2), { t: freshOpening, p: 14.29 });
  });
});
