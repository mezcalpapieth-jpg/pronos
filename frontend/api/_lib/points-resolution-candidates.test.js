import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPointsResolutionCandidateInsert,
  formatPointsResolutionCandidate,
} from './points-resolution-candidates.js';

test('buildPointsResolutionCandidateInsert allows review candidates without a suggested winner', () => {
  const candidate = buildPointsResolutionCandidateInsert({
    pointsMarketId: 123,
    resolverType: 'manual_review',
    source: 'premios-juventud',
    sourceEventId: 'award:pj-2026:new-artist',
    outcomeIndex: null,
    outcomeCount: 5,
    confidenceBps: 0,
    finalScoreText: 'Ceremonia cerrada',
    evidence: [{ title: 'Sitio oficial', url: 'https://example.com' }],
    rawReport: { source: 'test' },
  });

  assert.equal(candidate.points_market_id, 123);
  assert.equal(candidate.outcome_index, null);
  assert.equal(candidate.outcome_count, 5);
  assert.equal(candidate.confidence_bps, 0);
  assert.equal(candidate.status, 'pending');
  assert.deepEqual(candidate.raw_report, { source: 'test' });
});

test('formatPointsResolutionCandidate labels pending manual review clearly', () => {
  const formatted = formatPointsResolutionCandidate({
    id: 9,
    points_market_id: 123,
    resolver_type: 'manual_review',
    outcome_index: null,
    outcome_count: 3,
    confidence_bps: 0,
    evidence: '[{"title":"Fuente"}]',
    status: 'pending',
  }, ['PSG', 'Arsenal', 'Otro']);

  assert.equal(formatted.id, 9);
  assert.equal(formatted.pointsMarketId, 123);
  assert.equal(formatted.label, 'Elegir resultado');
  assert.equal(formatted.needsOutcome, true);
  assert.equal(formatted.confidenceLabel, null);
  assert.deepEqual(formatted.evidence, [{ title: 'Fuente' }]);
});

test('formatPointsResolutionCandidate resolves an indexed suggested outcome', () => {
  const formatted = formatPointsResolutionCandidate({
    id: 10,
    points_market_id: 123,
    outcome_index: 1,
    confidence_bps: 7200,
    status: 'pending',
  }, ['Sí', 'No']);

  assert.equal(formatted.label, 'No');
  assert.equal(formatted.needsOutcome, false);
  assert.equal(formatted.confidenceLabel, '72%');
});
