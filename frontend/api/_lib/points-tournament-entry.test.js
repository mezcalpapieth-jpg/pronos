import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tournamentCutoffSnapshotLock,
  tournamentMarketSettlementMs,
  tournamentSettlementLock,
} from './points-tournament-entry.js';

const duringTournament = new Date('2026-08-26T20:00:00.000Z');

test('tournament settlement guard allows markets closing at the ranking cutoff', () => {
  const lock = tournamentSettlementLock({
    tournament_featured: true,
    end_time: '2026-08-27T05:59:00.000Z',
    resolver_config: {
      closesAt: '2026-08-27T05:59:00.000Z',
    },
  }, duringTournament);

  assert.equal(lock, null);
});

test('tournament settlement guard blocks featured markets settling after the ranking cutoff', () => {
  const lock = tournamentSettlementLock({
    tournament_featured: true,
    end_time: '2026-08-27T06:00:00.000Z',
  }, duringTournament);

  assert.equal(lock?.error, 'tournament_market_after_cutoff');
  assert.equal(lock?.status, 400);
});

test('tournament settlement guard uses resolver closesAt before endTime', () => {
  const lock = tournamentSettlementLock({
    tournamentFeatured: true,
    endTime: '2026-08-27T05:30:00.000Z',
    resolverConfig: JSON.stringify({
      closesAt: '2026-08-27T06:30:00.000Z',
    }),
  }, duringTournament);

  assert.equal(tournamentMarketSettlementMs({
    endTime: '2026-08-27T05:30:00.000Z',
    resolverConfig: JSON.stringify({ closesAt: '2026-08-27T06:30:00.000Z' }),
  }), new Date('2026-08-27T06:30:00.000Z').getTime());
  assert.equal(lock?.error, 'tournament_market_after_cutoff');
});

test('tournament settlement guard ignores non-tournament markets', () => {
  const lock = tournamentSettlementLock({
    tournament_featured: false,
    end_time: '2026-08-27T06:30:00.000Z',
  }, duringTournament);

  assert.equal(lock, null);
});

function snapshotStatusDb({ activeCycle = true, snapshotCount = 0 } = {}) {
  return {
    async query(text) {
      if (/FROM points_cycles/.test(text)) {
        return {
          rows: activeCycle
            ? [{
              id: 12,
              label: 'Ciclo 12 ago - 26 ago',
              started_at: '2026-08-12T15:00:00.000Z',
              ends_at: '2026-08-27T05:59:00.000Z',
            }]
            : [],
        };
      }
      if (/FROM points_cycle_snapshots/.test(text)) {
        return { rows: [{ count: snapshotCount }] };
      }
      return { rows: [] };
    },
  };
}

test('tournament cutoff snapshot lock waits after cutoff until the photo is written', async () => {
  const lock = await tournamentCutoffSnapshotLock(
    snapshotStatusDb({ snapshotCount: 0 }),
    { tournament_featured: true },
    new Date('2026-08-27T06:00:00.000Z'),
  );

  assert.equal(lock?.error, 'tournament_snapshot_pending');
  assert.equal(lock?.status, 423);
});

test('tournament cutoff snapshot lock allows trading before cutoff or after photo exists', async () => {
  const beforeCutoff = await tournamentCutoffSnapshotLock(
    snapshotStatusDb({ snapshotCount: 0 }),
    { tournament_featured: true },
    new Date('2026-08-27T05:58:59.000Z'),
  );
  const afterSnapshot = await tournamentCutoffSnapshotLock(
    snapshotStatusDb({ snapshotCount: 4 }),
    { tournament_featured: true },
    new Date('2026-08-27T06:00:00.000Z'),
  );
  const regularMarket = await tournamentCutoffSnapshotLock(
    snapshotStatusDb({ snapshotCount: 0 }),
    { tournament_featured: false },
    new Date('2026-08-27T06:00:00.000Z'),
  );

  assert.equal(beforeCutoff, null);
  assert.equal(afterSnapshot, null);
  assert.equal(regularMarket, null);
});
