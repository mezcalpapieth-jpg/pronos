import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { automaticConfig, isAutomaticContract, RT_THRESHOLD_KIND, RT_THRESHOLD_FILMS } from './automated-market-rules.js';
import { collectCutoffEvidence, readCutoffResult } from './official-cutoff-snapshots.js';
import { readOfficialResult } from './official-results.js';
import { buildYouCanSeeEverythingMarket, YOU_CAN_SEE_EVERYTHING_CUTOFF } from './market-gen/you-can-see-everything-2026.js';

const movie = RT_THRESHOLD_FILMS['you-can-see-everything-2026'];
const spec = buildYouCanSeeEverythingMarket({ now: new Date('2026-10-19T15:00:00Z') });
const cfg = spec.resolver_config;
function page(score = '99') {
  const critics = { title: 'Tomatometer', reviewCount: 117, ...(score == null ? {} : { score, scorePercent: `${score}%` }) };
  return `<link rel="canonical" href="${movie.url}"><h1>${movie.title}</h1>
    <script type="application/ld+json">${JSON.stringify({ '@type': 'Movie', dateCreated: '2026-09-06', director: movie.directors.map(name => ({ name })) })}</script>
    <media-scorecard><rt-text slot="critics-score">${score == null ? '' : `${score}%`}</rt-text><rt-text slot="critics-score-type">Tomatometer</rt-text>
    <rt-text slot="audience-score">100%</rt-text></media-scorecard>
    <script id="media-scorecard-json">${JSON.stringify({ criticsScore: critics, overlay: { criticsAll: critics, criticsTop: { score: '100' } } })}</script>`;
}
const clock = () => new Date('2026-10-26T05:58:10Z');
const collect = html => collectCutoffEvidence(cfg, { clock, fetchImpl: async url => { assert.equal(url, movie.url); return new Response(html); } });
const sqlFor = payload => ({ query: async () => ({ rows: [{ payload, started_at: payload.startedAt, captured_at: payload.capturedAt }] }) });
const resolve = (payload, extra = {}) => readOfficialResult(cfg, spec.outcomes, {
  marketId: 1, sql: sqlFor(payload), now: new Date('2026-10-27'), fetchImpl: () => assert.fail('later live page must not be read'), ...extra,
});

test('requested Sunday market is bilingual, opens 50/50, and uses the strict 95% boundary at 23:59 CDMX', () => {
  assert.equal(spec.end_time, YOU_CAN_SEE_EVERYTHING_CUTOFF);
  assert.equal(new Date(spec.end_time).toLocaleTimeString('en-GB', { timeZone: 'America/Mexico_City', hour12: false }), '23:59:00');
  assert.equal(cfg.threshold, 95);
  assert.equal(spec.resolver_type, 'api_chart');
  assert.equal(isAutomaticContract(cfg), true);
  assert.deepEqual(spec.seed_liquidities, [1875, 1875]);
  assert.deepEqual(spec.source_data.suggestedPricing.probabilities, [0.5, 0.5]);
  assert.match(spec.source_data.translations.en.question, /above 95%/);
  assert.match(cfg.criteria, /95% o menos corresponde a No/);
  assert.match(cfg.criteriaEn, /Only the closing score counts/);
  assert.equal(spec.tournament_featured, false);
  for (const patch of [{ threshold: 94 }, { film: 'unverified-movie' }, { criteriaEn: 'Use audience score' },
    { cutoff: '2026-10-26T05:59:59Z' }, { resolveAt: '2026-10-26T05:58:00Z' }]) {
    assert.equal(isAutomaticContract({ ...cfg, ...patch }), false);
  }
  assert.throws(() => automaticConfig(RT_THRESHOLD_KIND, { cutoff: spec.end_time, film: '__proto__', threshold: 95 }), /invalid_rt/);
});

test('collector verifies the new film identity, both directors and All Critics, then archives the actual page', async () => {
  const html = page();
  const { payload, archive } = await collect(html);
  assert.equal(payload.score, 99);
  assert.equal(payload.reviewCount, 117);
  assert.equal(payload.evidenceUrl, movie.url);
  assert.equal(payload.documents[0].sha256, createHash('sha256').update(html).digest('hex'));
  assert.equal(archive.length, 1);
  for (const wrong of [html.replace(movie.url, 'https://www.rottentomatoes.com/m/other'),
    html.replace('<h1>You Can See Everything', '<h1>Other Movie'), html.replace('Lance Oppenheim', 'Other Director'),
    html.replace('2026-09-06', '2025-09-06'), html.replace('>99%<', '>98%<'), '<html>Access denied</html>']) {
    await assert.rejects(collect(wrong), e => e.manualReview);
  }
});

test('official reader settles 96–100 as Sí, 0–95 as No, and keeps the captured percentage for the banner', async () => {
  for (const [score, winningIdx] of [[0, 1], [94, 1], [95, 1], [96, 0], [99, 0], [100, 0]]) {
    const { payload } = await collect(page(String(score)));
    const result = await resolve(payload);
    assert.equal(result.winningIdx, winningIdx);
    assert.equal(result.resolverInfo.finalScore, `Tomatometer ${score}% · Rotten Tomatoes · 117 críticas`);
  }
  const { payload } = await collect(page(null));
  assert.equal((await resolve(payload)).cancel, true);
});

test('no snapshot, stale or later evidence, a different film, and changed outcomes require manual review', async () => {
  const { payload } = await collect(page('96'));
  await assert.rejects(resolve(payload, { sql: { query: async () => [] } }), e => e.manualReview);
  for (const patch of [{ capturedAt: '2026-10-26T05:59:01Z' }, { startedAt: '2026-10-26T05:57:59Z' },
    { evidenceUrl: 'https://www.rottentomatoes.com/m/other' }, { documents: [] }, { score: 101 }]) {
    await assert.rejects(resolve({ ...payload, ...patch }), e => e.manualReview);
  }
  await assert.rejects(readCutoffResult(cfg, ['No', 'Sí'], { sql: sqlFor(payload), marketId: 1, now: new Date('2026-10-27') }), /outcomes/);
  // Exercise the actual cron formatter without starting the cron or connecting to a database.
  const source = readFileSync(new URL('../cron/points-auto-resolve.js', import.meta.url), 'utf8');
  const formatter = source.slice(source.indexOf('function buildFinalScore('), source.indexOf('function normalizeEvidenceItem('));
  const buildFinalScore = new Function(`${formatter}; return buildFinalScore;`)();
  const result = await resolve(payload);
  assert.equal(buildFinalScore({ resolverType: 'api_chart', cfg, ...result, outcomes: spec.outcomes }), result.resolverInfo.finalScore);
});
