import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNetflixTop10ResolutionReview,
  fetchNetflixTop10Rows,
  latestNetflixWeek,
  parseNetflixTop10Tsv,
  topNetflixRows,
} from './netflix-top10.js';

test('Netflix Top 10 parser selects the latest TV rows for Mexico', () => {
  const rows = parseNetflixTop10Tsv([
    'country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title',
    'Mexico\tMX\t2026-08-30\tTV (English)\t1\tWednesday\tSeason 2',
    'Mexico\tMX\t2026-09-06\tTV (English)\t2\tWednesday\tSeason 2',
    'Mexico\tMX\t2026-09-06\tTV (Non-English)\t1\tLas Muertas\t',
    'Mexico\tMX\t2026-09-06\tFilms (English)\t1\tNot TV\t',
  ].join('\n'));

  assert.equal(latestNetflixWeek(rows), '2026-09-06');
  const picked = topNetflixRows(rows, { country: 'MX', limit: 2 });
  assert.deepEqual(picked.map(item => item.title), ['Las Muertas', 'Wednesday']);
});

test('Netflix countries TSV fetch uses a longer timeout than global charts', async (t) => {
  const originalAbortSignal = globalThis.AbortSignal;
  let observedTimeoutMs = null;
  globalThis.AbortSignal = {
    timeout(ms) {
      observedTimeoutMs = ms;
      return {};
    },
  };
  t.after(() => {
    globalThis.AbortSignal = originalAbortSignal;
  });

  await fetchNetflixTop10Rows({
    scope: 'mx',
    countriesUrl: 'https://example.test/countries.tsv',
    fetchImpl: async () => ({
      ok: true,
      text: async () => [
        'country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title',
        'Mexico\tMX\t2026-09-06\tTV (English)\t1\tWednesday',
      ].join('\n'),
    }),
  });

  assert.equal(observedTimeoutMs, 20000);
});

test('Netflix Top 10 review suggests Sí when title reaches target rank', async () => {
  const rows = parseNetflixTop10Tsv([
    'country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title',
    'Mexico\tMX\t2026-08-30\tTV (English)\t1\tWednesday\tSeason 2',
    'Mexico\tMX\t2026-09-06\tTV (English)\t2\tWednesday\tSeason 2',
    'Mexico\tMX\t2026-09-06\tTV (Non-English)\t1\tLas Muertas\t',
  ].join('\n'));

  const review = await buildNetflixTop10ResolutionReview({
    market: { id: 7, source_event_id: 'netflix-top10:mx:top3:2026-09-08:wednesday' },
    cfg: {},
    sourceData: {
      kind: 'netflix_top10',
      title: 'Wednesday',
      scope: 'mx',
      targetRank: 3,
      latestKnownWeek: '2026-08-30',
    },
    outcomes: ['Sí', 'No'],
    rows,
    now: new Date('2026-09-08T14:00:00Z'),
  });

  assert.equal(review.resolverConfigPatch.source, 'netflix-top10');
  assert.equal(review.resolverConfigPatch.suggestedOutcomeIndex, 0);
  assert.equal(review.resolverConfigPatch.confidenceBps, 8200);
  assert.match(review.resolverConfigPatch.finalScore, /#2 Wednesday/);
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.latestWeek, '2026-09-06');
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.rank, 2);
});

test('Netflix Top 10 review suggests No when a title is absent from the latest chart', async () => {
  const rows = parseNetflixTop10Tsv([
    'week\tcategory\tweekly_rank\tshow_title\tseason_title',
    '2026-08-30\tTV (English)\t1\tWednesday\tSeason 2',
    '2026-09-06\tTV (English)\t1\tBlack Rabbit\t',
    '2026-09-06\tTV (Non-English)\t2\tLas Muertas\t',
  ].join('\n'));

  const review = await buildNetflixTop10ResolutionReview({
    market: { id: 8 },
    cfg: {},
    sourceData: {
      kind: 'netflix_top10',
      title: 'Wednesday',
      scope: 'global',
      targetRank: 1,
      latestKnownWeek: '2026-08-30',
    },
    outcomes: ['Sí', 'No'],
    rows,
  });

  assert.equal(review.resolverConfigPatch.suggestedOutcomeIndex, 1);
  assert.match(review.resolverConfigPatch.finalScore, /no aparece/);
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.rank, null);
});

test('Netflix Top 10 review waits for a newer published week', async () => {
  const rows = parseNetflixTop10Tsv([
    'week\tcategory\tweekly_rank\tshow_title\tseason_title',
    '2026-08-30\tTV (English)\t1\tWednesday\tSeason 2',
  ].join('\n'));

  await assert.rejects(
    () => buildNetflixTop10ResolutionReview({
      market: { id: 9 },
      cfg: {},
      sourceData: {
        kind: 'netflix_top10',
        title: 'Wednesday',
        scope: 'global',
        targetRank: 1,
        latestKnownWeek: '2026-08-30',
      },
      outcomes: ['Sí', 'No'],
      rows,
    }),
    err => err?.code === 'netflix_top10_not_published_yet',
  );
});
