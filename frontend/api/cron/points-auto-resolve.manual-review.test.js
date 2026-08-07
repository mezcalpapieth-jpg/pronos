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
