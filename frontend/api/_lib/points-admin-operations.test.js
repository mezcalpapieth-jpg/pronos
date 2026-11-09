import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { checkPendingProposal, proposalChecks } from './points-admin-approval-checks.js';
import { cancelPointsMarket } from './points-cancel-market.js';
import { assertExpectedResolution, readSettlementPreview } from './points-admin-settlement-preview.js';
import { PRONOS_TREASURY_USERNAME } from './points-limit-orders.js';
import { resolverCheckResult, writeResolverChecks } from './points-resolver-diagnostics.js';

const asSql = db => async (strings, ...params) => (await db.query(
  strings.reduce((query, value, index) => query + (index ? '$' + index : '') + value, ''), params,
)).rows;

test('settlement previews read all legs and cancellation previews leave positions and orders intact', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_markets (id int PRIMARY KEY, parent_id int, status text DEFAULT 'active', resolver_config jsonb);
    CREATE TABLE points_positions (market_id int, username text, outcome_index int, shares numeric, cost_basis numeric);
    CREATE TABLE points_limit_orders (market_id int, status text, reserved_collateral numeric);
    INSERT INTO points_markets (id,parent_id) VALUES (1,NULL),(2,1),(3,1),(4,NULL);
    INSERT INTO points_positions VALUES (2,'luz',0,20,10), (3,'luz',1,8,3), (3,'leo',0,10,2),
      (2,'leo',1,0,3),(4,'leo',0,15,12);
    INSERT INTO points_limit_orders VALUES (1,'open',3), (2,'open',6), (3,'filled',5), (4,'open',10);
  `);
  await db.query('INSERT INTO points_positions VALUES (2,$1,0,45,0)', [PRONOS_TREASURY_USERNAME]);
  assert.deepEqual(await readSettlementPreview(db, [1, 2, 3], { winners: new Map([[2, 0], [3, 1]]) }), {
    holderCount: 1, amount: '28', orderCount: 2, reservedAmount: '9',
  });
  assert.deepEqual(await db.transaction(client => cancelPointsMarket(client, 1, { preview: true })), {
    ok: true, preview: { holderCount: 2, amount: '15', orderCount: 2, reservedAmount: '9' },
  });
  assert.deepEqual((await db.query('SELECT status FROM points_markets WHERE id=1')).rows, [{ status: 'active' }]);
  assert.equal((await db.query('SELECT SUM(shares)::text AS total FROM points_positions')).rows[0].total, '98');
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM points_limit_orders WHERE status='open'")).rows[0].count, 3);
  assert.throws(() => assertExpectedResolution({ resolved_at: new Date() }, null), { message: 'resolution_changed', status: 409 });
});

test('proposal checks block definite duplicates and missing fixture IDs while allowing a canceled market to be relaunched', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const row = {
    source: 'espn', source_event_id: 'event-42', question: '¿Ganará el local?',
    end_time: new Date(Date.now() + 86400000), outcomes: ['Sí', 'No'],
    resolver_type: 'sports_api', resolver_config: { source: 'espn', shape: 'binary' },
  };
  assert.deepEqual(proposalChecks(row).filter(check => check.severity === 'block').map(check => check.code), ['missing_fixture_id']);
  row.resolver_config.eventId = 42;
  await db.exec(`
    CREATE TABLE points_markets (id int, mode text DEFAULT 'points', source text, source_event_id text,
      question text, end_time timestamptz, outcomes jsonb, parent_id int, archived_at timestamptz, status text);
  `);
  await db.query("INSERT INTO points_markets (id, source, source_event_id, question, end_time, outcomes, status) VALUES (3,'espn','event-42','¿Ganará el local?',$1,'[\"Sí\",\"No\"]','canceled')", [row.end_time]);
  const blocked = await db.transaction(client => checkPendingProposal(client, row, { lock: true }));
  assert.ok(blocked.some(check => check.code === 'duplicate_market' && check.marketId === 3 && check.severity === 'block'));
  const relaunch = await checkPendingProposal(db, row, { approvalEventId: 'event-42:reopen-3-5' });
  assert.ok(relaunch.some(check => check.code === 'missing_criteria' && check.severity === 'warning'));
  assert.ok(relaunch.every(check => check.severity === 'warning'));
  await db.query(`INSERT INTO points_markets (id, question, end_time, outcomes, status)
    VALUES (4,'¿Ganará el local?',$1::timestamptz + INTERVAL '1 hour','["Sí","No"]','active')`, [row.end_time]);
  const similar = await checkPendingProposal(db, row, { approvalEventId: 'event-42:reopen-3-5' });
  assert.ok(similar.some(check => check.code === 'similar_market' && check.marketId === 4 && check.severity === 'warning'));
});

test('resolver diagnostics keep the newest blocker and last verified response across overlapping checks', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_markets (id int PRIMARY KEY);
    INSERT INTO points_markets VALUES (1);
    CREATE TABLE points_resolver_checkpoints (
      market_id int, checkpoint_key text, last_checked_at timestamptz, metadata jsonb, updated_at timestamptz,
      PRIMARY KEY(market_id, checkpoint_key)
    );
  `);
  const market = { resolver_type: 'sports_api', resolver_config: { source: 'espn' } };
  const latest = resolverCheckResult({ market, deferred: { reason: 'not_finished_yet', notFound: true },
    sourceUrl: 'https://fixture.test/score?api_key=secret' });
  const sourceResponseAt = '2026-10-29T10:00:00.000Z';
  const older = resolverCheckResult({ market, deferred: { reason: 'not_finished_yet' }, sourceResponseAt });
  const save = (checked_at, metadata) => writeResolverChecks(asSql(db), [{ market_id: 1, checked_at, metadata }]);
  await save('2026-10-29T11:00:00Z', latest);
  await save('2026-10-29T09:59:00Z', older);
  const { rows: [row] } = await db.query('SELECT last_checked_at, metadata FROM points_resolver_checkpoints');
  assert.equal(row.last_checked_at.toISOString(), '2026-10-29T11:00:00.000Z');
  assert.equal(row.metadata.status, 'fixture_mismatch');
  assert.equal(row.metadata.sourceUrl, null);
  assert.equal(new Date(row.metadata.sourceResponseAt).toISOString(), sourceResponseAt);
});
