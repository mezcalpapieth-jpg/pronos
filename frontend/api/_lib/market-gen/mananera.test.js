import test from 'node:test';
import assert from 'node:assert/strict';

import { MANANERA_TRANSCRIPT_SOURCE, readMananeraPhraseResult } from '../mananera.js';
import {
  generateMananeraMarkets,
  nextMananeraClose,
  nextMananeraWeek,
} from './mananera.js';

test('nextMananeraClose targets the same business morning before local close', () => {
  const close = nextMananeraClose(new Date('2026-08-10T12:00:00.000Z'));
  assert.equal(close.toISOString(), '2026-08-10T13:59:00.000Z');
});

test('nextMananeraClose skips weekends after Friday local close', () => {
  const close = nextMananeraClose(new Date('2026-08-07T16:00:00.000Z'));
  assert.equal(close.toISOString(), '2026-08-10T13:59:00.000Z');
});

test('generateMananeraMarkets creates pending specs with transcript resolver metadata', async () => {
  const specs = await generateMananeraMarkets({ now: new Date('2026-08-10T12:00:00.000Z') });
  assert.equal(specs.length, 6);

  const inegi = specs.find(s => s.source_event_id === 'mananera:2026-08-10:inegi');
  assert.ok(inegi);
  assert.equal(inegi.category, 'mexico');
  assert.deepEqual(inegi.outcomes, ['Sí', 'No']);
  assert.equal(inegi.resolver_type, 'api_transcript');
  assert.equal(inegi.resolver_config.source, MANANERA_TRANSCRIPT_SOURCE);
  assert.equal(inegi.resolver_config.dateYmd, '2026-08-10');
  assert.equal(inegi.resolver_config.phrase, 'INEGI');
  assert.equal(inegi.resolver_config.yesOutcome, 0);
  assert.equal(inegi.resolver_config.youtubeFallback, true);
  assert.equal(inegi.resolver_config.countSpeaker, 'president');
  assert.equal(inegi.resolver_config.requireCompleteTranscript, true);
  assert.match(inegi.resolver_config.criteria, /intervenciones de la presidenta/);
  assert.ok(inegi.resolver_config.criteria.includes('YouTube'));
  assert.ok(inegi.resolver_config.sourceUrls.includes('https://www.youtube.com/'));
  assert.match(inegi.source_data.transcriptSource, /YouTube/);
  assert.equal(inegi.source_data.categorization.categoryTags[0], 'mexico');
  assert.equal(inegi.source_data.categorization.geoTags[0], 'mexico');
  assert.deepEqual(inegi.source_data.categorization.topicTags, ['politica']);
  assert.equal(inegi.source_data.suggestedPricing.source, 'editorial-prior');
  assert.equal(inegi.seed_liquidities.length, 2);
  assert.ok(inegi.seed_liquidities.every(n => Number(n) > 0));

  const weekly = specs.find(s => s.source_event_id === 'mananera-weekly:2026-08-10:tema-editable-semanal');
  assert.ok(weekly);
  assert.equal(weekly.resolver_type, 'api_transcript');
  assert.equal(weekly.end_time, '2026-08-10T13:59:00.000Z');
  assert.deepEqual(weekly.resolver_config.dateYmds, [
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
  ]);
  assert.equal(weekly.resolver_config.phrase, 'seguridad');
  assert.equal(weekly.source_data.editableTemplate, true);
  assert.match(weekly.source_data.approvalEditHints.note, /Cambiar el tema/);
});

test('nextMananeraWeek uses the next full week after Monday close', () => {
  const week = nextMananeraWeek(new Date('2026-08-10T16:00:00.000Z'));
  assert.equal(week.weekStartYmd, '2026-08-17');
  assert.equal(week.weekEndYmd, '2026-08-21');
  assert.equal(week.start.toISOString(), '2026-08-17T13:59:00.000Z');
});

test('readMananeraPhraseResult sums weekly transcript dates', async () => {
  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmds: ['2026-08-10', '2026-08-11', '2026-08-12'],
    phrase: 'agua',
    op: 'gte',
    threshold: 3,
    yesOutcome: 0,
    youtubeFallback: false,
  }, {
    storedTranscripts: {
      '2026-08-10': {
        dateYmd: '2026-08-10',
        url: 'https://example.test/10',
        title: 'Mañanera 10',
        transcriptText: 'PRESIDENTA DE MÉXICO: Agua y seguridad. Agua potable.\nPREGUNTA: Agua, agua.\n—000—',
      },
      '2026-08-11': {
        dateYmd: '2026-08-11',
        url: 'https://example.test/11',
        title: 'Mañanera 11',
        transcriptText: 'PRESIDENTA DE MÉXICO: Sin menciones.\nPREGUNTA: Agua, agua.\n—000—',
      },
      '2026-08-12': {
        dateYmd: '2026-08-12',
        url: 'https://example.test/12',
        title: 'Mañanera 12',
        transcriptText: 'PRESIDENTA DE MÉXICO: Habló de agua.\nPREGUNTA: Agua, agua.\n—000—',
      },
    },
  });

  assert.equal(result.ready, true);
  assert.equal(result.count, 3);
  assert.equal(result.outcomeIndex, 0);
  assert.deepEqual(result.dateYmds, ['2026-08-10', '2026-08-11', '2026-08-12']);
  assert.deepEqual(result.dailyCounts.map(item => item.count), [2, 0, 1]);
  assert.deepEqual(result.transcriptUrls, [
    'https://example.test/10',
    'https://example.test/11',
    'https://example.test/12',
  ]);
});

test('weekly markets wait for every complete transcript even after a positive day', async () => {
  const result = await readMananeraPhraseResult({
    source: MANANERA_TRANSCRIPT_SOURCE,
    dateYmds: ['2026-08-10', '2026-08-11'], phrase: 'IMSS', threshold: 1,
    yesOutcome: 0, youtubeFallback: false,
  }, {
    storedTranscripts: {
      '2026-08-10': { dateYmd: '2026-08-10', transcriptText: 'PRESIDENTA DE MÉXICO: IMSS.\n—000—' },
    },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () =>
      `<p>11 de agosto de 2026</p><p>PRESIDENTA DE MÉXICO: ${'Buenos días. '.repeat(60)}</p><p>(CONTINÚA…)</p>` }),
  });
  assert.equal(result.ready, false);
  assert.equal(result.pendingDateYmd, '2026-08-11');
  assert.equal(result.reason, 'official_transcript_incomplete');
  assert.equal(result.outcomeIndex, undefined);
});
