import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLcdlfResolutionReview,
  buildLcdlfWeeklyMarketSpec,
  extractResidentsFromIndexHtml,
  parseLcdlfResidentStatus,
} from './lcdlf-official.js';

test('parseLcdlfResidentStatus recognizes official status labels', () => {
  assert.equal(parseLcdlfResidentStatus('<span>EN CASA</span>').key, 'en_casa');
  assert.equal(parseLcdlfResidentStatus('<span>NOMINADA</span>').key, 'nominado');
  assert.equal(parseLcdlfResidentStatus('<span>ELIMINADO</span>').key, 'eliminado');
});

test('extractResidentsFromIndexHtml finds official resident profile links', () => {
  const rows = extractResidentsFromIndexHtml(`
    <a href="/habitantes/ernesto-laguardia"><strong>Ernesto Laguardia</strong></a>
    <a href="https://www.lacasadelosfamososmexico.tv/habitantes/memo-schutz">Memo Schutz</a>
  `);

  assert.deepEqual(rows.map(row => row.slug), ['ernesto-laguardia', 'memo-schutz']);
  assert.deepEqual(rows.map(row => row.name), ['Ernesto Laguardia', 'Memo Schutz']);
});

test('buildLcdlfWeeklyMarketSpec creates a manual-review market from nominees', () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.lacasadelosfamososmexico.tv',
    observedAt: now.toISOString(),
    parsedCount: 3,
    total: 3,
    rows: [
      { name: 'Ernesto Laguardia', slug: 'ernesto-laguardia', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/ernesto' },
      { name: 'Memo Schutz', slug: 'memo-schutz', statusKey: 'nominado', statusLabel: 'Nominado/a', url: 'https://example.com/memo' },
      { name: 'Yahir', slug: 'yahir', statusKey: 'en_casa', statusLabel: 'En casa', url: 'https://example.com/yahir' },
    ],
    nominated: [
      { name: 'Ernesto Laguardia', statusLabel: 'Nominado/a', url: 'https://example.com/ernesto' },
      { name: 'Memo Schutz', statusLabel: 'Nominado/a', url: 'https://example.com/memo' },
    ],
    eliminated: [],
    active: [],
  };

  const spec = buildLcdlfWeeklyMarketSpec({ snapshot, now });
  assert.equal(spec.source, 'lcdlf-official');
  assert.equal(spec.resolver_type, 'manual_review');
  assert.deepEqual(spec.outcomes, ['Ernesto Laguardia', 'Memo Schutz']);
  assert.equal(spec.category, 'musica');
  assert.deepEqual(spec.topic_tags, ['tv', 'farandula']);
  assert.match(spec.source_event_id, /^lcdlf-mx-elimination:/);
  assert.equal(spec.resolver_config.requireHumanConfirmation, true);
});

test('buildLcdlfResolutionReview suggests the eliminated nominee only after official evidence', async () => {
  const now = new Date('2026-08-10T12:00:00Z');
  const snapshot = {
    ok: true,
    sourceUrl: 'https://www.lacasadelosfamososmexico.tv',
    observedAt: now.toISOString(),
    parsedCount: 2,
    total: 2,
    rows: [
      { name: 'Ernesto Laguardia', slug: 'ernesto-laguardia', statusKey: 'en_casa', statusLabel: 'En casa', url: 'https://example.com/ernesto' },
      { name: 'Memo Schutz', slug: 'memo-schutz', statusKey: 'eliminado', statusLabel: 'Eliminado/a', url: 'https://example.com/memo' },
    ],
    nominated: [],
    eliminated: [
      { name: 'Memo Schutz', slug: 'memo-schutz', statusKey: 'eliminado', statusLabel: 'Eliminado/a', url: 'https://example.com/memo' },
    ],
    active: [],
  };

  const review = await buildLcdlfResolutionReview({
    market: { id: 123, source_event_id: 'lcdlf-mx-elimination:2026-08-16' },
    cfg: {},
    sourceData: { kind: 'lcdlf_week' },
    outcomes: ['Ernesto Laguardia', 'Memo Schutz'],
    snapshot,
    now,
  });

  assert.equal(review.resolverConfigPatch.suggestedOutcomeIndex, 1);
  assert.equal(review.resolverConfigPatch.confidenceBps, 8500);
  assert.match(review.resolverConfigPatch.rationale, /Memo Schutz/);
  assert.equal(review.resolverConfigPatch.evidenceUrl, 'https://example.com/memo');
});
