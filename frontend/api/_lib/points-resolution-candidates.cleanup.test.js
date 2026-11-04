import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { closeCompletedPointsResolutionCandidates, upsertPendingPointsResolutionCandidate, buildPointsResolutionCandidateInsert } from './points-resolution-candidates.js';

test('completion closes only pending suggestions for completed Points markets, without changing outcomes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE points_markets (id bigint PRIMARY KEY, mode text, status text, outcome int);
      CREATE TABLE points_resolution_candidates (id int PRIMARY KEY, points_market_id bigint, status text, outcome_index int, reviewer text, reviewed_at timestamptz, admin_note text);
      INSERT INTO points_markets VALUES (1,'points','resolved',0),(2,'points','canceled',NULL),(3,'points','active',NULL),(4,'onchain','resolved',0),(5,'points','resolved',1);
      INSERT INTO points_resolution_candidates (id,points_market_id,status,outcome_index) VALUES
        (1,1,'pending',0),(2,1,'pending',1),(3,1,'pending',NULL),(4,2,'pending',0),
        (5,3,'pending',0),(6,4,'pending',0),(7,1,'denied',0),(8,5,'pending',1);
    `);
    const before = (await db.query('SELECT * FROM points_markets ORDER BY id')).rows;
    const closed = await closeCompletedPointsResolutionCandidates(db, [1,2,3,4,1]);
    assert.equal(closed.length, 4);
    const rows = (await db.query('SELECT * FROM points_resolution_candidates ORDER BY id')).rows;
    assert.deepEqual(rows.map(r => r.status), ['confirmed','denied','denied','denied','pending','pending','denied','pending']);
    assert.equal(rows[2].outcome_index, null);
    assert.equal(rows[6].reviewed_at, null);
    assert.ok(rows[0].reviewed_at);
    assert.deepEqual((await db.query('SELECT * FROM points_markets ORDER BY id')).rows, before);
    assert.deepEqual(await closeCompletedPointsResolutionCandidates(db, [1,2,3,4]), []);
  } finally { await db.close(); }
});

test('late evidence cannot recreate a pending review after settlement or cancellation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE points_markets (id bigint PRIMARY KEY, mode text, status text, outcome int);
      CREATE TABLE points_resolution_candidates (id serial PRIMARY KEY, points_market_id bigint,
        resolver_type text, source text, source_event_id text, outcome_index int, outcome_count int,
        confidence_bps int, observed_at timestamptz, final_score text, evidence_url text, evidence jsonb,
        rationale text, raw_report jsonb, status text, reviewer text, reviewed_at timestamptz, admin_note text);
      CREATE UNIQUE INDEX pending_candidate ON points_resolution_candidates(points_market_id) WHERE status = 'pending';
      INSERT INTO points_markets VALUES (1,'points','active',NULL),(2,'points','resolved',0),(3,'points','canceled',NULL),(4,'onchain','active',NULL);`);
    const candidate = id => buildPointsResolutionCandidateInsert({ pointsMarketId: id, outcomeIndex: 0, outcomeCount: 2, source: 'test', rationale: 'first' });
    for (const id of [2,3,4]) {
      await db.transaction(async tx => assert.deepEqual(await upsertPendingPointsResolutionCandidate(tx, candidate(id)), []));
    }
    const first = await db.transaction(tx => upsertPendingPointsResolutionCandidate(tx, candidate(1)));
    const refreshed = await db.transaction(tx => upsertPendingPointsResolutionCandidate(tx, { ...candidate(1), rationale: 'refreshed' }));
    assert.equal(first[0].id, refreshed[0].id);
    assert.equal((await db.query('SELECT rationale FROM points_resolution_candidates')).rows[0].rationale, 'refreshed');
    await db.transaction(async tx => {
      await tx.query("UPDATE points_markets SET status='resolved',outcome=0 WHERE id=1");
      await closeCompletedPointsResolutionCandidates(tx, [1]);
    });
    await db.transaction(async tx => assert.deepEqual(await upsertPendingPointsResolutionCandidate(tx, candidate(1)), []));
    assert.deepEqual((await db.query('SELECT status FROM points_resolution_candidates')).rows, [{ status: 'confirmed' }]);
  } finally { await db.close(); }
});
