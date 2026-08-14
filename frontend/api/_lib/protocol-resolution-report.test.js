import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertAuthorizedCreRequest,
  normalizeProtocolResolutionReport,
  validateProtocolResolutionReportForMarket,
} from './protocol-resolution-report.js';

test('normalizeProtocolResolutionReport accepts a Chainlink CRE report', () => {
  const report = normalizeProtocolResolutionReport({
    resolverType: 'chainlink-cre',
    status: 'ready',
    protocolMarketId: '1516',
    source: 'sports-api',
    sourceEventId: 'espn-nba-401766123',
    outcomeIndex: '1',
    outcomeCount: '2',
    confidenceBps: '9800',
    observedAt: '2026-05-18T14:00:00.000Z',
    finalScore: { home: '102', away: '109' },
    evidenceUrl: 'https://example.com/events/espn-nba-401766123',
  }, {
    nowMs: Date.parse('2026-05-18T14:03:00.000Z'),
    maxAgeMs: 10 * 60 * 1000,
  });

  assert.deepEqual(report, {
    resolverType: 'chainlink-cre',
    status: 'ready',
    protocolMarketId: 1516,
    source: 'sports-api',
    sourceEventId: 'espn-nba-401766123',
    outcomeIndex: 1,
    outcomeCount: 2,
    confidenceBps: 9800,
    observedAt: '2026-05-18T14:00:00.000Z',
    finalScore: { home: '102', away: '109' },
    finalScoreText: '102-109',
    evidenceUrl: 'https://example.com/events/espn-nba-401766123',
  });
});

test('normalizeProtocolResolutionReport accepts an AI-monitored candidate report', () => {
  const report = normalizeProtocolResolutionReport({
    resolverType: 'chainlink-cre-ai',
    status: 'candidate',
    protocolMarketId: '1516',
    source: 'ai-search',
    sourceEventId: 'sentiment-market-1516',
    outcomeIndex: '0',
    outcomeCount: '2',
    confidenceBps: '9100',
    observedAt: '2026-05-18T14:00:00.000Z',
    finalScore: 'Anuncio confirmado',
    evidenceUrl: 'https://example.com/source',
    evidence: [
      { title: 'Comunicado oficial', url: 'https://example.com/source', quote: 'confirmado' },
    ],
    rationale: 'La fuente principal confirma el resultado.',
  }, {
    nowMs: Date.parse('2026-05-18T14:02:00.000Z'),
  });

  assert.equal(report.resolverType, 'chainlink-cre-ai');
  assert.equal(report.status, 'candidate');
  assert.equal(report.finalScoreText, 'Anuncio confirmado');
  assert.deepEqual(report.evidence, [
    { title: 'Comunicado oficial', url: 'https://example.com/source', quote: 'confirmado' },
  ]);
  assert.equal(report.rationale, 'La fuente principal confirma el resultado.');
});

test('normalizeProtocolResolutionReport rejects stale or impossible reports', () => {
  assert.throws(() => normalizeProtocolResolutionReport({
    resolverType: 'chainlink-cre',
    protocolMarketId: 1516,
    source: 'sports-api',
    sourceEventId: 'espn-nba-401766123',
    outcomeIndex: 1,
    outcomeCount: 2,
    confidenceBps: 9800,
    observedAt: '2026-05-18T12:00:00.000Z',
  }, {
    nowMs: Date.parse('2026-05-18T14:00:00.000Z'),
    maxAgeMs: 30 * 60 * 1000,
  }), /report_stale/);

  assert.throws(() => normalizeProtocolResolutionReport({
    resolverType: 'chainlink-cre',
    protocolMarketId: 1516,
    source: 'sports-api',
    sourceEventId: 'espn-nba-401766123',
    outcomeIndex: 2,
    outcomeCount: 2,
    confidenceBps: 9800,
    observedAt: '2026-05-18T14:00:00.000Z',
  }, {
    nowMs: Date.parse('2026-05-18T14:00:00.000Z'),
  }), /invalid_outcome/);
});

test('validateProtocolResolutionReportForMarket checks source identity and confidence', () => {
  const market = {
    id: 1516,
    status: 'active',
    outcome_count: 2,
    source: 'sports-api',
    source_event_id: 'espn-nba-401766123',
  };
  const report = normalizeProtocolResolutionReport({
    resolverType: 'chainlink-cre',
    protocolMarketId: 1516,
    source: 'sports-api',
    sourceEventId: 'espn-nba-401766123',
    outcomeIndex: 1,
    outcomeCount: 2,
    confidenceBps: 9400,
    observedAt: '2026-05-18T14:00:00.000Z',
  }, {
    nowMs: Date.parse('2026-05-18T14:00:00.000Z'),
  });

  assert.doesNotThrow(() => validateProtocolResolutionReportForMarket(report, market, {
    minConfidenceBps: 9000,
  }));

  assert.throws(() => validateProtocolResolutionReportForMarket({
    ...report,
    sourceEventId: 'wrong-event',
  }, market), /report_source_mismatch/);

  assert.throws(() => validateProtocolResolutionReportForMarket({
    ...report,
    confidenceBps: 8500,
  }, market, {
    minConfidenceBps: 9000,
  }), /report_confidence_too_low/);
});

test('assertAuthorizedCreRequest accepts bearer or fallback header secrets', () => {
  assert.doesNotThrow(() => assertAuthorizedCreRequest({
    headers: { authorization: 'Bearer cre-secret' },
  }, 'cre-secret'));

  assert.doesNotThrow(() => assertAuthorizedCreRequest({
    headers: { 'x-pronos-cre-secret': 'cre-secret' },
  }, 'cre-secret'));

  assert.throws(() => assertAuthorizedCreRequest({
    headers: { authorization: 'Bearer wrong' },
  }, 'cre-secret'), /cre_resolution_unauthorized/);

  assert.throws(() => assertAuthorizedCreRequest({
    headers: { authorization: 'Bearer cre-secret' },
  }, ''), /cre_resolution_secret_not_configured/);
});
