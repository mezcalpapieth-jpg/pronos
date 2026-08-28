import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NEXT_TOURNAMENT_OPERATION_CLOSE_ISO,
  NEXT_TOURNAMENT_RANKING_CUTOFF_ISO,
  NEXT_TOURNAMENT_START_ISO,
  TOURNAMENT_CYCLE_LABEL,
  TOURNAMENT_HOLD_REWARD_MAX_WEEKS,
  TOURNAMENT_HOLD_REWARD_WEEKLY_RATE,
  TOURNAMENT_LIQUIDITY_REWARD_MAX_DAILY_PER_USER,
  TOURNAMENT_LIQUIDITY_REWARD_WEEKLY_RATE,
  TOURNAMENT_OPERATION_CLOSE_ISO,
  TOURNAMENT_PARLAY_EDGE_FACTOR,
  TOURNAMENT_PARLAY_MAX_LEGS,
  TOURNAMENT_PARLAY_MIN_LEGS,
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

test('points tournament exposes hold reward and parlay rules', () => {
  const rules = tournamentRulesPayload();
  assert.equal(TOURNAMENT_HOLD_REWARD_WEEKLY_RATE, 0.25);
  assert.equal(TOURNAMENT_HOLD_REWARD_MAX_WEEKS, 4);
  assert.deepEqual(rules.holdReward, { weeklyRate: 0.25, maxWeeks: 4 });
  assert.equal(TOURNAMENT_LIQUIDITY_REWARD_WEEKLY_RATE, 0.20);
  assert.equal(TOURNAMENT_LIQUIDITY_REWARD_MAX_DAILY_PER_USER, 100);
  assert.deepEqual(rules.liquidityReward, { weeklyRate: 0.20, maxDailyPerUser: 100 });
  assert.equal(TOURNAMENT_PARLAY_MIN_LEGS, 3);
  assert.equal(TOURNAMENT_PARLAY_MAX_LEGS, 6);
  assert.equal(TOURNAMENT_PARLAY_EDGE_FACTOR, 0.75);
  assert.equal(rules.parlay.minLegs, 3);
  assert.equal(rules.parlay.maxLegs, 6);
  assert.equal(rules.parlay.edgeFactor, 0.75);
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
