import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEXT_TOURNAMENT_OPERATION_CLOSE_ISO,
  NEXT_TOURNAMENT_RANKING_CUTOFF_ISO,
  NEXT_TOURNAMENT_START_ISO,
  TOURNAMENT_CYCLE_LABEL,
  TOURNAMENT_OPERATION_CLOSE_ISO,
  TOURNAMENT_QUALIFYING_MARKETS,
  TOURNAMENT_RANKING_CUTOFF_ISO,
  TOURNAMENT_REWARDS,
  configuredCycleEndIso,
  configuredCycleWindowFromRow,
  getTournamentWindow,
  tournamentRulesActive,
  tournamentRulesPayload,
} from './points-tournament-config.js';

test('points tournament requires ten qualifying markets', () => {
  assert.equal(TOURNAMENT_QUALIFYING_MARKETS, 10);
  assert.equal(tournamentRulesPayload().qualifyingMarkets, 10);
});

test('points tournament social follow and post rewards are 100 MXNP', () => {
  assert.equal(TOURNAMENT_REWARDS.socialFollow, 100);
  assert.equal(TOURNAMENT_REWARDS.socialPost, 100);
});

test('current points tournament closes at 11:59pm Mexico City on August 26', () => {
  assert.equal(TOURNAMENT_CYCLE_LABEL, 'Ciclo 12 ago - 26 ago');
  assert.equal(TOURNAMENT_OPERATION_CLOSE_ISO, '2026-08-27T05:59:00.000Z');
  assert.equal(TOURNAMENT_RANKING_CUTOFF_ISO, '2026-08-27T05:59:00.000Z');
  assert.equal(tournamentRulesActive(new Date('2026-08-27T05:58:59.000Z')), true);
  assert.equal(tournamentRulesActive(new Date('2026-08-27T05:59:00.000Z')), false);
});

test('September points tournament starts at 9am Mexico City and lasts through September', () => {
  assert.equal(NEXT_TOURNAMENT_START_ISO, '2026-09-01T15:00:00.000Z');
  assert.equal(NEXT_TOURNAMENT_OPERATION_CLOSE_ISO, '2026-10-01T05:59:00.000Z');
  assert.equal(NEXT_TOURNAMENT_RANKING_CUTOFF_ISO, '2026-10-01T05:59:00.000Z');
  assert.equal(configuredCycleEndIso('2026-09-01T15:00:00.000Z'), NEXT_TOURNAMENT_OPERATION_CLOSE_ISO);

  const window = getTournamentWindow(new Date('2026-08-30T18:00:00.000Z'));
  assert.equal(window.status, 'scheduled');
  assert.equal(window.startsAt, NEXT_TOURNAMENT_START_ISO);
});

test('configured cycle rows extend stale stored ends to the current tournament close', () => {
  const row = configuredCycleWindowFromRow({
    id: 12,
    label: 'Ciclo anterior',
    started_at: '2026-08-12T15:00:00.000Z',
    ends_at: '2026-08-26T05:59:00.000Z',
  });
  assert.equal(row.endsAt, TOURNAMENT_RANKING_CUTOFF_ISO);
  assert.equal(row.operationCloseAt, TOURNAMENT_OPERATION_CLOSE_ISO);
  assert.equal(row.label, TOURNAMENT_CYCLE_LABEL);
});
