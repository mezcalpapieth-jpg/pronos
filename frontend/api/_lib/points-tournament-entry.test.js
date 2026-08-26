import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
