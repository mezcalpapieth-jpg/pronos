import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './entertainment.js';

test('entertainment award pricing leaves a small Otro reserve', () => {
  assert.deepEqual(
    _internal.awardProbabilities(5).map(v => Math.round(v * 100)),
    [23, 23, 23, 23, 8],
  );
});

test('entertainment binary pricing accepts configured yes probability', () => {
  assert.deepEqual(_internal.binaryProbabilitiesFromYes(65), [0.65, 0.35]);
  assert.deepEqual(_internal.binaryProbabilitiesFromYes(0.4), [0.4, 0.6]);
});

test('entertainment AI pricing stays gated behind env flag and key', () => {
  const oldFlag = process.env.ENTERTAINMENT_PRICING_AI_ENABLED;
  const oldKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ENTERTAINMENT_PRICING_AI_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(_internal.aiPricingEnabled(), false);
    process.env.ENTERTAINMENT_PRICING_AI_ENABLED = 'true';
    assert.equal(_internal.aiPricingEnabled(), false);
    process.env.ANTHROPIC_API_KEY = 'test';
    assert.equal(_internal.aiPricingEnabled(), true);
  } finally {
    if (oldFlag == null) delete process.env.ENTERTAINMENT_PRICING_AI_ENABLED;
    else process.env.ENTERTAINMENT_PRICING_AI_ENABLED = oldFlag;
    if (oldKey == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = oldKey;
  }
});

test('popular event markets use the longer capped horizon', () => {
  const now = Date.UTC(2026, 7, 11, 12, 0, 0);
  const ninetyDays = new Date(now + 90 * 86_400_000).toISOString();

  assert.equal(_internal.withinHorizon(ninetyDays, { now }), false);
  assert.equal(_internal.withinHorizon(ninetyDays, { now, horizonDays: 180 }), true);
});

test('popular event spec carries manual criteria, evidence, and tags', () => {
  const resolveAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
  const spec = _internal.popularEventSpec({
    kind: 'popular_event',
    key: 'test-popular',
    question: '¿GTA VI se retrasa otra vez antes de su lanzamiento?',
    category: 'general',
    topic: 'gaming',
    resolveAt,
    probabilityYes: 30,
    criteria: 'Resolver Sí si una fuente oficial anuncia una fecha posterior antes del cierre.',
    evidence: [
      { title: 'Fuente oficial', url: 'https://example.com/source', publishedAt: '2026-08-11' },
    ],
    tags: {
      categoryTags: ['general'],
      geoTags: ['world'],
      topicTags: ['general'],
    },
  });

  assert.equal(spec.source, 'popular');
  assert.equal(spec.source_event_id, 'popular:test-popular');
  assert.equal(spec.resolver_type, 'manual_review');
  assert.equal(spec.resolver_config.criteria, 'Resolver Sí si una fuente oficial anuncia una fecha posterior antes del cierre.');
  assert.deepEqual(spec.outcomes, ['Sí', 'No']);
  assert.deepEqual(spec.category_tags, ['general']);
  assert.deepEqual(spec.geo_tags, ['world']);
  assert.deepEqual(spec.topic_tags, ['general']);
  assert.deepEqual(spec.source_data.categorization, {
    geoTags: ['world'],
    topicTags: ['general'],
  });
  assert.deepEqual(spec.source_data.sourceUrls, ['https://example.com/source']);
  assert.equal(spec.source_data.suggestedPricing.source, 'admin-config');
  assert.deepEqual(spec.source_data.suggestedPricing.probabilityPct, [30, 70]);
});

test('popular event spec supports one multi-outcome manual market', () => {
  const resolveAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const spec = _internal.popularEventSpec({
    kind: 'popular_event',
    key: 'test-multi-popular',
    question: '¿Quién será anunciado como Magneto en D23?',
    category: 'musica',
    topic: 'cine',
    eventLabel: 'D23',
    resolveAt,
    outcomes: ['Robert Pattinson', 'Adam Driver', 'Otro actor', 'No anuncian a Magneto'],
    probabilities: [22, 13, 20, 45],
    criteria: 'Resolver con anuncio oficial o trades principales después del evento.',
    evidence: [
      { title: 'D23', url: 'https://d23.com/ultimatefanevent2026-copy/' },
    ],
    tags: {
      categoryTags: ['musica'],
      geoTags: ['world'],
      topicTags: ['cine'],
    },
  });

  assert.equal(spec.source_event_id, 'popular:test-multi-popular');
  assert.equal(spec.amm_mode, 'unified');
  assert.deepEqual(spec.outcomes, ['Robert Pattinson', 'Adam Driver', 'Otro actor', 'No anuncian a Magneto']);
  assert.equal(spec.source_data.eventLabel, 'D23');
  assert.deepEqual(spec.topic_tags, ['cine']);
  assert.deepEqual(spec.source_data.suggestedPricing.probabilityPct, [22, 13, 20, 45]);
});

test('TMDb weekend box-office discovery emits manual-review pending specs', () => {
  const weekend = _internal.currentWeekendWindow(new Date('2026-08-21T12:00:00Z'));
  const spec = _internal.movieWeekendBoxOfficeSpec({
    id: 123,
    title: 'Spider-Man: Brand New Day',
    release_date: '2026-08-20',
    popularity: 210,
    poster_path: '/poster.jpg',
    overview: 'A new Spider-Man movie.',
  }, { weekend, rank: 0 });

  assert.equal(spec.source, 'entertainment-api');
  assert.equal(spec.source_event_id, 'tmdb-box-office-weekend:2026-08-21:123');
  assert.equal(spec.question, '¿Spider-Man: Brand New Day será #1 en taquilla de EE.UU. este fin de semana?');
  assert.equal(spec.start_time, '2026-08-21T00:00:00.000Z');
  assert.equal(spec.end_time, '2026-08-24T18:00:00.000Z');
  assert.equal(spec.resolver_type, 'manual_review');
  assert.equal(spec.source_data.kind, 'box_office_weekend');
  assert.equal(spec.source_data.tmdbId, 123);
  assert.equal(spec.source_data.posterUrl, 'https://image.tmdb.org/t/p/w500/poster.jpg');
  assert.deepEqual(spec.outcomes, ['Sí', 'No']);
  assert.deepEqual(spec.geo_tags, ['us-canada']);
  assert.deepEqual(spec.topic_tags, ['cine']);
  assert.equal(spec.source_data.suggestedPricing.source, 'source-signals:tmdb-popularity');
});

test('Netflix drafts identify the exact chart, target week, and applicable rank', () => {
  const item = { title: 'La Casa', rank: 1, row: { week: '2026-08-16' } };
  const close = new Date('2026-08-25T06:00:00Z');
  const targetWeek = '2026-08-23';
  const global = _internal.netflixTop10Spec(item, { chart: 'global-non-en', close, targetWeek });
  const english = _internal.netflixTop10Spec(item, { chart: 'global-en', close, targetWeek });
  const mexico = _internal.netflixTop10Spec(item, { chart: 'mx', close, targetWeek });

  assert.equal(global.source, 'entertainment-api');
  assert.match(global.question, /otros idiomas.*2026-08-23/);
  assert.equal(global.start_time, '2026-08-25T00:00:00.000Z');
  assert.equal(global.end_time, '2026-08-25T06:00:00.000Z');
  assert.equal(global.resolver_type, 'manual_review');
  assert.equal(global.resolver_config.chart, 'global-non-en');
  assert.equal(global.resolver_config.targetWeek, targetWeek);
  assert.match(global.resolver_config.evidence[0].url, /tv-non-english\?week=2026-08-16$/);
  assert.equal(global.source_data.targetRank, 1);
  assert.deepEqual(global.geo_tags, ['world']);
  assert.notEqual(global.source_event_id, english.source_event_id);
  assert.match(english.question, /series en inglés/);
  assert.match(mexico.question, /Top 3.*México/);
  assert.equal(mexico.source_data.targetRank, 3);
  assert.deepEqual(mexico.geo_tags, ['mexico']);
  assert.equal(mexico.source_data.suggestedPricing.source, 'source-signals:netflix-top10-rank');
});

test('API entertainment discovery is gated by env vars', () => {
  const oldFlag = process.env.ENTERTAINMENT_API_DISCOVERY_ENABLED;
  const oldTmdbKey = process.env.TMDB_API_KEY;
  const oldTmdbToken = process.env.TMDB_READ_ACCESS_TOKEN;
  try {
    delete process.env.ENTERTAINMENT_API_DISCOVERY_ENABLED;
    delete process.env.TMDB_API_KEY;
    delete process.env.TMDB_READ_ACCESS_TOKEN;
    assert.equal(_internal.apiDiscoveryEnabled(), true);
    assert.equal(_internal.tmdbEnabled(), false);
    process.env.TMDB_API_KEY = 'test-key';
    assert.equal(_internal.tmdbEnabled(), true);
    process.env.ENTERTAINMENT_API_DISCOVERY_ENABLED = 'false';
    assert.equal(_internal.apiDiscoveryEnabled(), false);
    assert.equal(_internal.tmdbEnabled(), false);
  } finally {
    if (oldFlag == null) delete process.env.ENTERTAINMENT_API_DISCOVERY_ENABLED;
    else process.env.ENTERTAINMENT_API_DISCOVERY_ENABLED = oldFlag;
    if (oldTmdbKey == null) delete process.env.TMDB_API_KEY;
    else process.env.TMDB_API_KEY = oldTmdbKey;
    if (oldTmdbToken == null) delete process.env.TMDB_READ_ACCESS_TOKEN;
    else process.env.TMDB_READ_ACCESS_TOKEN = oldTmdbToken;
  }
});
