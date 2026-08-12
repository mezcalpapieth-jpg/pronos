import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./points-auto-resolve.js', import.meta.url), 'utf8');

test('points auto-resolver queues manual-review markets instead of auto-paying them', () => {
  assert.match(SOURCE, /manual_review\/manual markets are not auto-settled/);
  assert.match(SOURCE, /buildPointsResolutionCandidateInsert/);
  assert.match(SOURCE, /points_resolution_candidates/);
  assert.match(SOURCE, /manual_review_queued/);
  assert.match(SOURCE, /ON CONFLICT \(points_market_id\) WHERE status = 'pending'/);
});

test('points auto-resolver picks up entertainment markets after close time', () => {
  assert.match(SOURCE, /m\.resolver_type IN \('manual', 'manual_review'\)/);
  assert.match(SOURCE, /m\.source IN \('entertainment', 'codex-entertainment', 'codex-premios-juventud-2026'\)/);
  assert.match(SOURCE, /m\.category = 'musica'/);
  assert.match(SOURCE, /pm\.source_data->>'kind' IN \('award', 'reality_week', 'reality_winner', 'concert'\)/);
  assert.match(SOURCE, /isManualReviewMarket/);
});

test('points auto-resolver lets trusted chart APIs resolve music markets', () => {
  assert.match(SOURCE, /AUTO_RESOLVABLE_API_CHART_SOURCES = new Set/);
  assert.match(SOURCE, /'apple-mx-songs'/);
  assert.match(SOURCE, /'youtube-trending-mx'/);
  assert.match(SOURCE, /isAutoResolvableApiChart\(\{ resolverType: rt, source \}\)\) return false/);
});

test('points auto-resolver queues chart API failures for manual review', () => {
  assert.match(SOURCE, /queueApiChartFallbackReview/);
  assert.match(SOURCE, /El lector automático de charts no pudo confirmar el resultado/);
  assert.match(SOURCE, /api_chart_manual_review_queue_failed/);
});

test('points auto-resolver settles eliminated tennis and golf child legs early', () => {
  assert.match(SOURCE, /readEspnAtpMatchWinner/);
  assert.match(SOURCE, /function isEarlyTournamentLegSource/);
  assert.match(SOURCE, /'espn-atp-tournament', 'espn-pga'/);
  assert.match(SOURCE, /m\.resolver_config->>'shape' = 'parallel'/);
  assert.match(SOURCE, /m\.resolver_config->>'source' IN \('espn-atp-tournament', 'espn-pga'\)/);
  assert.match(SOURCE, /m\.end_time > NOW\(\)/);
  assert.match(SOURCE, /function resolveEliminatedParallelLegs/);
  assert.match(SOURCE, /result\?\.eliminatedCompetitors/);
  assert.match(SOURCE, /result\?\.remainingCompetitors/);
  assert.match(SOURCE, /function eliminatedCompetitorsForLegs/);
  assert.match(SOURCE, /not_in_remaining_draw/);
  assert.match(SOURCE, /function otherLegCoveredByNamedRemaining/);
  assert.match(SOURCE, /field_fully_covered/);
  assert.match(SOURCE, /function findRemainingParallelLegIndexes/);
  assert.match(SOURCE, /resolved_alive_leg_has_redemptions/);
  assert.match(SOURCE, /alive_in_remaining_draw/);
  assert.match(SOURCE, /releaseOpenLimitOrdersForMarkets\(client, targetIds/);
  assert.match(SOURCE, /SET status = 'resolved',\s*outcome = 1/);
  assert.match(SOURCE, /resolved_by = \$1/);
  assert.match(SOURCE, /resolver:\$\{cfg\.source\}:early-elimination/);
  assert.match(SOURCE, /WHERE parent_id = \$1\s+AND status <> 'canceled'\s+ORDER BY id ASC/);
  assert.match(SOURCE, /row && row\.status === 'active'/);
});

test('points auto-resolver queues next-day mañanera markets when current transcript markets close', () => {
  assert.match(SOURCE, /generateMananeraMarkets/);
  assert.match(SOURCE, /prepareGeneratedSpecs/);
  assert.match(SOURCE, /upsertPending/);
  assert.match(SOURCE, /function isMananeraMarket/);
  assert.match(SOURCE, /queueNextMananeraPendingMarkets/);
  assert.match(SOURCE, /report\.mananeraNextPending/);
  assert.match(SOURCE, /mananera_next_pending_failed/);
});

test('points auto-resolver polls LCDLF nomination markets before close and resolves by official status', () => {
  assert.match(SOURCE, /api_lcdlf/);
  assert.match(SOURCE, /if \(rt === 'api_lcdlf'\) return false/);
  assert.match(SOURCE, /readLcdlfOfficialSnapshot/);
  assert.match(SOURCE, /findLcdlfStatusRow/);
  assert.match(SOURCE, /m\.resolver_type = 'api_lcdlf'/);
  assert.match(SOURCE, /m\.resolver_config->>'shape' = 'binary-status'/);
  assert.match(SOURCE, /nominationRoundPosted/);
  assert.match(SOURCE, /snapshot\.nominated\.length >= nominationMinStatusCount/);
  assert.match(SOURCE, /lcdlf_status_not_marked_yet/);
  assert.match(SOURCE, /buildLcdlfStatusPatch/);
});
