import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { buildTournamentLeaderboardRows } from './points-tournament-leaderboard.js';
import { configuredCycleWindowFromRow } from './points-tournament-config.js';

const window = {
  id: 5, startsAt: '2026-10-01T06:00:00.000Z',
  operationCloseAt: '2026-11-01T05:59:59.000Z',
  rankingCutoffAt: '2026-11-01T05:59:59.000Z',
};
async function fixture(t, { parent = false, touch = false } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_users(username TEXT, created_at TIMESTAMPTZ, profile_image_url TEXT);
    CREATE TABLE points_balances(username TEXT, balance NUMERIC);
    CREATE TABLE points_markets(id INTEGER PRIMARY KEY, parent_id INTEGER, created_at TIMESTAMPTZ,
      tournament_featured BOOLEAN, status TEXT, outcome INTEGER, reserves JSONB, outcomes JSONB,
      start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, resolved_at TIMESTAMPTZ, resolver_config JSONB);
    CREATE TABLE points_pending_markets(id INTEGER, approved_market_id INTEGER, reviewed_at TIMESTAMPTZ, source_data JSONB);
    CREATE TABLE points_trades(id INTEGER, username TEXT, market_id INTEGER, outcome_index INTEGER,
      side TEXT, shares NUMERIC, collateral NUMERIC, price_at_trade NUMERIC, created_at TIMESTAMPTZ);
    CREATE TABLE points_positions(username TEXT, market_id INTEGER, outcome_index INTEGER,
      shares NUMERIC, cost_basis NUMERIC, realized_pnl NUMERIC);
    INSERT INTO points_users VALUES('ana', '2026-10-01T06:00:00Z', NULL);
    INSERT INTO points_balances VALUES('ana', 850);
    INSERT INTO points_markets VALUES(10, NULL, '2026-09-01T06:00:00Z', true,
      'resolved', 0, '[1000,1000]', '["Yes","No"]', '2026-10-01T15:00:00Z',
      '2026-10-02T15:00:00Z', '2026-10-02T15:05:00Z', '{}');
    INSERT INTO points_trades VALUES
      (1,'ana',10,0,'buy',1000,600,0.6,'2026-10-01T15:00:00Z'),
      (2,'ana',10,0,'sell',250,200,0.8,'2026-10-01T20:00:00Z'),
      (3,'ana',10,0,'redeem',750,750,1,'2026-10-02T15:10:00Z');
    INSERT INTO points_positions VALUES('ana',10,0,0,0,350);
    ALTER TABLE points_trades ADD COLUMN source TEXT DEFAULT 'web';
  `);
  if (parent) await db.exec(`
    INSERT INTO points_markets SELECT 20,NULL,created_at,true,status,outcome,reserves,outcomes,
      start_time,end_time,resolved_at,resolver_config FROM points_markets WHERE id=10;
    UPDATE points_markets SET parent_id=20,tournament_featured=false,
      start_time=NULL,end_time=NULL,resolved_at=NULL,resolver_config=NULL WHERE id=10;
  `);
  await db.query(`INSERT INTO points_pending_markets VALUES(1,$1,'2026-09-01T06:00:00Z',$2::jsonb)`,
    [parent ? 20 : 10, JSON.stringify({ kind: touch ? 'price_touch_up' : 'binary', article: 'full source article '.repeat(1000) })]);
  return { db, query: (text, params) => db.query(text, params) };
}

test('grouped SQL history preserves FIFO sells, redemption, qualification and conviction', async t => {
  const db = await fixture(t);
  const [row] = await buildTournamentLeaderboardRows(db, { window,
    now: new Date('2026-10-03T17:00:00Z'), includeConvictionBreakdown: true });
  assert.equal(row.marketPnl, 350);
  assert.equal(row.convictionBonus, 30);
  assert.equal(row.score, 380);
  assert.equal(row.qualifyingMarkets, 1);
  assert.equal(row.totalActions, 3);
  assert.equal(row.activeDays, 2);
  assert.equal(row.inactiveDays, 0);
  assert.equal(row.convictionBreakdown[0].eligibleShares, 750);
});

test('grouped child-market metadata preserves parent eligibility and touch exclusions', async t => {
  const db = await fixture(t, { parent: true, touch: true });
  const [row] = await buildTournamentLeaderboardRows(db, { window, now: new Date('2026-10-03T17:00:00Z') });
  assert.equal(row.marketPnl, 350);
  assert.equal(row.convictionBonus, 0);
  assert.equal(row.score, 350);
  assert.equal(row.qualifyingMarkets, 1);
  assert.equal(row.activeDays, 2);
});

test('November 1 market results and trades count before the extended cutoff', async t => {
  const db = await fixture(t);
  await db.db.exec(`
    UPDATE points_markets SET start_time='2026-11-01T15:00:00Z',
      end_time='2026-11-01T20:00:00Z',resolved_at='2026-11-01T20:05:00Z';
    UPDATE points_trades SET created_at=CASE id
      WHEN 1 THEN '2026-11-01T15:00:00Z'::timestamptz
      WHEN 2 THEN '2026-11-01T16:00:00Z'::timestamptz
      ELSE '2026-11-01T20:10:00Z'::timestamptz END;
  `);
  const extendedWindow = configuredCycleWindowFromRow({
    id: 5, started_at: window.startsAt, ends_at: window.rankingCutoffAt,
  });
  const now = new Date('2026-11-02T06:00:00Z');
  const [row] = await buildTournamentLeaderboardRows(db, { window: extendedWindow, now });
  assert.equal(row.marketPnl, 350);
  assert.equal(row.qualifyingMarkets, 1);
  assert.equal(row.activeDays, 1);
  const [beforeExtension] = await buildTournamentLeaderboardRows(db, { window, now });
  assert.equal(beforeExtension.marketPnl, 0);
  assert.equal(beforeExtension.qualifyingMarkets, 0);
});
