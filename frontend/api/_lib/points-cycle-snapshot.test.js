import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readActiveCycleCutoffSnapshotStatus,
  snapshotActiveCycleAtCutoff,
} from './points-cycle-snapshot.js';

const octoberCycle = {
  id: 5,
  label: 'Torneo Octubre 2026',
  started_at: '2026-10-01T06:00:00.000Z',
  ends_at: '2026-11-01T05:59:00.000Z',
};
const cutoffAt = '2026-11-02T05:59:59.000Z';

function snapshotDb() {
  const calls = [];
  return {
    calls,
    async query(text) {
      calls.push(text);
      if (/FROM points_cycles/.test(text)) return { rows: [octoberCycle] };
      if (/SELECT COUNT/.test(text)) return { rows: [{ count: 1 }] };
      if (/FROM points_cycle_snapshots s/.test(text)) {
        return { rows: [{ username: 'winner', rank: 1, tournament_score: 100 }] };
      }
      throw new Error(`Unexpected snapshot query: ${text}`);
    },
  };
}

test('October snapshot waits through the old cutoff and the extra tournament day', async () => {
  for (const iso of ['2026-11-01T05:59:00.000Z', '2026-11-01T05:59:59.000Z', '2026-11-01T06:00:00.000Z', '2026-11-02T05:59:58.999Z']) {
    const db = snapshotDb();
    const result = await snapshotActiveCycleAtCutoff(db, { now: new Date(iso) });
    assert.equal(result.skipped, 'before_cutoff');
    assert.equal(result.cutoffAt, cutoffAt);
    assert.equal(result.snapshotted, 0);
    assert.equal(db.calls.length, 1);
  }
});

test('October snapshot status passes the extended cutoff only on November 1 at 23:59:59 Mexico City', async () => {
  const before = await readActiveCycleCutoffSnapshotStatus(snapshotDb(), {
    now: new Date('2026-11-02T05:59:58.999Z'),
  });
  const atCutoff = await readActiveCycleCutoffSnapshotStatus(snapshotDb(), {
    now: new Date(cutoffAt),
  });
  assert.equal(before.cutoffAt, cutoffAt);
  assert.equal(before.cutoffPassed, false);
  assert.equal(before.snapshotTaken, false);
  assert.equal(atCutoff.cutoffPassed, true);
  assert.equal(atCutoff.snapshotTaken, true);
});

test('midnight snapshot job uses the exact cutoff and preserves an existing snapshot', async () => {
  const db = snapshotDb();
  const result = await snapshotActiveCycleAtCutoff(db, {
    now: new Date('2026-11-02T06:00:00.000Z'),
  });
  assert.equal(result.cutoffAt, cutoffAt);
  assert.equal(result.skipped, 'already_snapshotted');
  assert.equal(result.snapshotted, 1);
  assert.equal(result.winners[0].username, 'winner');
  assert.ok(db.calls.every(text => /^\s*SELECT\b/.test(text)));
});
