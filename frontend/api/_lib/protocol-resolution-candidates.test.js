import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildResolutionCandidateInsert,
  formatResolutionCandidate,
} from './protocol-resolution-candidates.js';

test('buildResolutionCandidateInsert persists the suggested resolution review shape', () => {
  const candidate = buildResolutionCandidateInsert({
    resolverType: 'chainlink-cre-ai',
    status: 'candidate',
    protocolMarketId: 1516,
    source: 'ai-search',
    sourceEventId: 'sentiment-market-1516',
    outcomeIndex: 0,
    outcomeCount: 2,
    confidenceBps: 9300,
    observedAt: '2026-05-18T14:00:00.000Z',
    finalScoreText: 'Confirmado',
    evidenceUrl: 'https://example.com/source',
    evidence: [{ title: 'Fuente', url: 'https://example.com/source' }],
    rationale: 'La evidencia pública confirma el resultado.',
  });

  assert.deepEqual(candidate, {
    protocol_market_id: 1516,
    resolver_type: 'chainlink-cre-ai',
    source: 'ai-search',
    source_event_id: 'sentiment-market-1516',
    outcome_index: 0,
    outcome_count: 2,
    confidence_bps: 9300,
    observed_at: '2026-05-18T14:00:00.000Z',
    final_score: 'Confirmado',
    evidence_url: 'https://example.com/source',
    evidence: [{ title: 'Fuente', url: 'https://example.com/source' }],
    rationale: 'La evidencia pública confirma el resultado.',
    status: 'pending',
  });
});

test('formatResolutionCandidate exposes Spanish admin review data', () => {
  const formatted = formatResolutionCandidate({
    id: 42,
    protocol_market_id: 1516,
    resolver_type: 'chainlink-cre-ai',
    source: 'ai-search',
    source_event_id: 'sentiment-market-1516',
    outcome_index: 1,
    outcome_count: 2,
    confidence_bps: 9100,
    observed_at: '2026-05-18T14:00:00.000Z',
    final_score: 'Se resolvió con evidencia pública',
    evidence_url: 'https://example.com/source',
    evidence: JSON.stringify([{ title: 'Fuente', url: 'https://example.com/source' }]),
    rationale: 'Se encontraron fuentes suficientes.',
    status: 'pending',
    created_at: '2026-05-18T14:01:00.000Z',
  }, ['Sí', 'No']);

  assert.equal(formatted.id, 42);
  assert.equal(formatted.label, 'No');
  assert.equal(formatted.confidenceLabel, '91%');
  assert.equal(formatted.statusLabel, 'Sugerida');
  assert.equal(formatted.finalScore, 'Se resolvió con evidencia pública');
  assert.deepEqual(formatted.evidence, [{ title: 'Fuente', url: 'https://example.com/source' }]);
});
