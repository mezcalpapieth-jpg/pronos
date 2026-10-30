import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMananeraFallbackReview } from './mananera-fallback.js';
import { MANANERA_TRANSCRIPT_SOURCE, readMananeraPhraseResult, findMananeraYouTubeTranscript } from './mananera.js';
import { buildPointsResolutionCandidateInsert } from './points-resolution-candidates.js';

const cfg = { source: MANANERA_TRANSCRIPT_SOURCE, dateYmd: '2026-10-29', phrase: 'tecnología', threshold: 1, yesOutcome: 0 };
const failure = {
  ready: false, reason: 'official_transcript_not_found', fallbackReason: 'youtube_captions_empty',
  youtubeVideoUrl: 'https://www.youtube.com/watch?v=OVb2fnxlIZM',
  youtubeCaptionAttempts: [{ videoUrl: 'https://www.youtube.com/watch?v=OVb2fnxlIZM', reason: 'youtube_captions_empty', captionBodyLength: 0 }],
};

test('empty October 29 captions queue a review with the recording, never an invented outcome', () => {
  const review = buildMananeraFallbackReview(cfg, failure, { now: new Date('2026-10-30T04:00:00Z') });
  assert.equal(review.evidenceUrl, failure.youtubeVideoUrl);
  assert.equal(review.outcomeIndex, null);
  assert.equal(review.suggestedOutcomeIndex, null);
  assert.equal(review.confidenceBps, 0);
  assert.equal(review.youtubeCaptionAttempts[0].captionBodyLength, 0);
  assert.match(review.rationale, /únicamente las intervenciones de la presidenta/);
  const candidate = buildPointsResolutionCandidateInsert({ pointsMarketId: 393923, ...review, outcomeCount: 2 });
  assert.equal(candidate.outcome_index, null);
});

test('normal publication delay does not queue review, and weekly counts wait for the last date', () => {
  assert.equal(buildMananeraFallbackReview(cfg, failure, { now: new Date('2026-10-29T23:59:59Z') }), null);
  assert.ok(buildMananeraFallbackReview(cfg, failure, { now: new Date('2026-10-30T00:00:00Z') }));
  assert.equal(buildMananeraFallbackReview({ ...cfg, dateYmd: undefined, dateYmds: ['2026-10-29', '2026-10-30'] },
    { ...failure, pendingDateYmd: '2026-10-29' }, { now: new Date('2026-10-30T04:00:00Z') }), null);
});

test('a late complete transcript still auto-resolves and counts only the president', async () => {
  const fullText = 'PRESIDENTA DE MÉXICO, CLAUDIA SHEINBAUM PARDO: Buenos días.\n'
    + 'PREGUNTA: tecnología\nPRESIDENTA DE MÉXICO, CLAUDIA SHEINBAUM PARDO: Hablamos de tecnología.\n—000—';
  const result = await readMananeraPhraseResult(cfg, {
    storedTranscript: { dateYmd: cfg.dateYmd, transcriptText: fullText, url: 'https://www.gob.mx/presidencia' },
    fetchImpl: () => { throw new Error('cached transcript must avoid network'); },
  });
  assert.equal(result.ready, true);
  assert.equal(result.count, 1);
  assert.equal(result.outcomeIndex, 0);
  assert.equal(buildMananeraFallbackReview(cfg, result), null);
});

test('a partial transcript or an unattributed video cannot become a negative result', async () => {
  const result = await readMananeraPhraseResult({ ...cfg, youtubeFallback: false }, {
    storedTranscript: { dateYmd: cfg.dateYmd, transcriptText: 'PRESIDENTA DE MÉXICO, CLAUDIA SHEINBAUM PARDO: Buenos días.\nCONTINÚA' },
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  });
  assert.equal(result.ready, false);
  assert.equal(result.outcomeIndex, undefined);
  assert.equal(buildMananeraFallbackReview(cfg, result, { now: new Date('2026-10-30T04:00:00Z') }).outcomeIndex, null);
});

test('network failures reach the evidence review path instead of stranding the market as an error', async () => {
  const result = await readMananeraPhraseResult(cfg, {
    youtubeApiKey: null,
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'official_transcript_fetch_failed');
  assert.ok(buildMananeraFallbackReview(cfg, result, { now: new Date('2026-10-30T04:00:00Z') }));
});

test('a broken first video still allows captions from the second official recording', async () => {
  const first = '44I9se-wMZs';
  const second = 'OVb2fnxlIZM';
  const result = await findMananeraYouTubeTranscript({
    dateYmd: cfg.dateYmd, youtubeApiKey: null,
    fetchImpl: async url => {
      const href = String(url);
      let body = '';
      if (href.includes('/feeds/videos.xml')) body = `<feed>${[first, second].map(id => `<entry><yt:videoId>${id}</yt:videoId><title>Conferencia de prensa matutina 29 de octubre 2026 | Presidenta Claudia Sheinbaum</title><author><name>Claudia Sheinbaum Pardo</name></author></entry>`).join('')}</feed>`;
      if (href.includes(`/watch?v=${first}`)) throw new TypeError('fetch failed');
      if (href.includes(`/watch?v=${second}`)) body = JSON.stringify({ captionTracks: [{ baseUrl: `https://www.youtube.com/api/timedtext?v=${second}&lang=es`, languageCode: 'es' }] });
      if (href.includes('/api/timedtext')) body = JSON.stringify({ events: [{ tStartMs: 1000, segs: [{ utf8: 'Texto para revisar sin atribución de hablantes. '.repeat(30) }] }] });
      return { ok: true, status: 200, text: async () => body };
    },
  });
  assert.equal(result.ready, true);
  assert.equal(result.videoId, second);
  assert.equal(result.captionAttempts[0].reason, 'youtube_captions_fetch_failed');
});
