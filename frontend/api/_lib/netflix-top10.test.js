import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertNetflixDraftChart,
  buildNetflixTop10ResolutionReview,
  fetchNetflixTop10PageRows,
  fetchNetflixTop10Rows,
  latestNetflixWeek,
  parseNetflixTop10PagePayload,
  parseNetflixTop10Tsv,
  topNetflixRows,
} from './netflix-top10.js';
import { _internal as entertainment } from './market-gen/entertainment.js';

function jsSingleQuotedJson(value) {
  return JSON.stringify(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function netflixPageHtml(items) {
  const payload = {
    data: Object.fromEntries(items.map((item, index) => [
      `PulseTop10ItemEntity:${index}`,
      {
        __typename: 'PulseTop10ItemEntity',
        top10: {
          weeklyRank: item.rank,
          weekEndDate: item.week || '2026-08-30',
          category: item.category || 'ENGLISH_SERIES',
        },
        top10Video: {
          title: item.title,
          parentShow: item.parentShow ? { title: item.parentShow } : null,
        },
      },
    ])),
  };
  return `<script>netflix.reactContext.models.graphql = JSON.parse('${jsSingleQuotedJson(payload)}');</script>`;
}

function fullChart(category, week) {
  return Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1, title: `${category} ${index + 1}`, category, week,
  }));
}

test('Netflix discovery keeps Mexico and non-English drafts when the English chart times out', async t => {
  t.mock.method(console, 'warn', () => {});
  const failures = [];
  const specs = await entertainment.discoverNetflixTop10Specs({
    now: new Date('2026-11-09T00:00:00Z'),
    fetchImpl: async url => {
      if (url.endsWith('/top10/tv')) throw new DOMException('expired', 'TimeoutError');
      const category = url.endsWith('/mexico/tv') ? 'SERIES' : 'NONENGLISH_SERIES';
      return new Response(netflixPageHtml(fullChart(category, '2026-11-01')));
    },
    reportFeedError: (feed, error) => failures.push([feed, error.code]),
  });
  assert.deepEqual(failures, [['Netflix · global-en', 'netflix_top10_timeout']]);
  assert.deepEqual(specs.map(s => s.source_data.chart), ['global-non-en', 'mx', 'mx']);
  assert.ok(specs.every(s => s.source_data.targetWeek === '2026-11-08'));
});

test('Netflix review uses the pinned week and language chart and rejects incomplete results', async () => {
  const week = '2026-11-08';
  const options = {
    cfg: { chart: 'global-non-en', targetWeek: week },
    sourceData: { title: 'Shared Show', targetRank: 1 },
    outcomes: ['Sí', 'No'],
  };
  const nonEnglish = fullChart('NONENGLISH_SERIES', week);
  nonEnglish[1].title = 'Shared Show';
  const english = fullChart('ENGLISH_SERIES', week);
  english[0].title = 'Shared Show';
  const review = await buildNetflixTop10ResolutionReview({
    ...options,
    fetchImpl: async url => {
      assert.match(url, /\/tv-non-english\?week=2026-11-08$/);
      return new Response(netflixPageHtml([...english, ...nonEnglish, ...fullChart('NONENGLISH_SERIES', '2026-11-15')]));
    },
  });
  assert.equal(review.resolverConfigPatch.suggestedOutcomeIndex, 1);
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.latestWeek, week);
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.rank, 2);
  await assert.rejects(buildNetflixTop10ResolutionReview({
    ...options, fetchImpl: async () => new Response(netflixPageHtml(nonEnglish.slice(0, 4))),
  }), { code: 'netflix_top10_incomplete_chart' });
  await assert.rejects(buildNetflixTop10ResolutionReview({
    ...options, fetchImpl: async () => new Response(netflixPageHtml(fullChart('NONENGLISH_SERIES', '2026-11-01'))),
  }), { code: 'netflix_top10_not_published_yet' });
});

test('pending approval rejects legacy Netflix drafts with an ambiguous global chart', () => {
  const draft = { source: 'entertainment-api', source_event_id: 'netflix-top10:global:number1:2026-11-10:lupin' };
  assert.throws(() => assertNetflixDraftChart(draft), { status: 409, code: 'netflix_top10_chart_required' });
  assert.doesNotThrow(() => assertNetflixDraftChart({ ...draft, source_event_id: draft.source_event_id.replace(':global:', ':global-non-en:') }));
  assert.doesNotThrow(() => assertNetflixDraftChart({ ...draft, source_event_id: draft.source_event_id.replace(':global:', ':mx:') }));
});

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

test('Netflix Top 10 page parser converts official page data into TV rows', async () => {
  const html = netflixPageHtml([
    {
      rank: 4,
      title: 'My Daughter’s Father',
      parentShow: '',
      category: 'SERIES',
    },
  ]);

  const payload = parseNetflixTop10PagePayload(html);
  assert.ok(payload.data);

  const fetched = await fetchNetflixTop10PageRows({
    scope: 'mx',
    mexicoTvUrl: 'https://example.test/mexico/tv',
    fetchImpl: async () => ({
      ok: true,
      text: async () => html,
    }),
  });

  assert.equal(fetched.source, 'official-page');
  assert.equal(fetched.rows.length, 1);
  assert.equal(fetched.rows[0].country_iso2, 'MX');
  assert.equal(fetched.rows[0].category, 'TV');
  assert.equal(fetched.rows[0].weekly_rank, '4');
  assert.equal(fetched.rows[0].show_title, 'My Daughter’s Father');
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

test('Netflix Top 10 review falls back to official pages when TSV data lags', async () => {
  const staleGlobalTsv = [
    'week\tcategory\tweekly_rank\tshow_title\tseason_title',
    '2026-08-23\tTV (English)\t1\tWednesday\tSeason 2',
  ].join('\n');
  const globalTvPage = netflixPageHtml([
    {
      rank: 1,
      title: 'Death of the Pastor’s Wife',
      parentShow: '',
      category: 'ENGLISH_SERIES',
    },
  ]);
  const nonEnglishTvPage = netflixPageHtml([
    {
      rank: 1,
      title: 'Blood Sacrifice: Season 1',
      parentShow: 'Blood Sacrifice',
      category: 'NONENGLISH_SERIES',
    },
  ]);

  const review = await buildNetflixTop10ResolutionReview({
    market: { id: 10, source_event_id: 'netflix-top10:global:top1:2026-09-02:blood-sacrifice' },
    cfg: {},
    sourceData: {
      kind: 'netflix_top10',
      title: 'Blood Sacrifice',
      scope: 'global',
      targetRank: 1,
      latestKnownWeek: '2026-08-23',
    },
    outcomes: ['Sí', 'No'],
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.endsWith('/all-weeks-global.tsv')) {
        return { ok: true, text: async () => staleGlobalTsv };
      }
      if (href.endsWith('/tv-non-english')) {
        return { ok: true, text: async () => nonEnglishTvPage };
      }
      if (href.endsWith('/tv')) {
        return { ok: true, text: async () => globalTvPage };
      }
      throw new Error(`unexpected URL ${href}`);
    },
  });

  assert.equal(review.resolverConfigPatch.suggestedOutcomeIndex, 0);
  assert.equal(review.resolverConfigPatch.autoResolve, true);
  assert.equal(review.resolverConfigPatch.autoResolveSource, 'official-page');
  assert.match(review.resolverConfigPatch.finalScore, /#1 Blood Sacrifice: Season 1/);
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.latestWeek, '2026-08-30');
  assert.equal(review.sourceDataPatch.netflixTop10LastSnapshot.source, 'official-page');
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
