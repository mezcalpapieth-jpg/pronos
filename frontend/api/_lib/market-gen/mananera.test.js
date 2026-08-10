import test from 'node:test';
import assert from 'node:assert/strict';

import { MANANERA_TRANSCRIPT_SOURCE } from '../mananera.js';
import {
  generateMananeraMarkets,
  nextMananeraClose,
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
  assert.equal(specs.length, 5);

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
  assert.ok(inegi.resolver_config.criteria.includes('YouTube'));
  assert.ok(inegi.resolver_config.sourceUrls.includes('https://www.youtube.com/'));
  assert.match(inegi.source_data.transcriptSource, /YouTube/);
  assert.equal(inegi.source_data.categorization.categoryTags[0], 'mexico');
  assert.equal(inegi.source_data.categorization.geoTags[0], 'mexico');
  assert.deepEqual(inegi.source_data.categorization.topicTags, ['politica']);
  assert.equal(inegi.source_data.suggestedPricing.source, 'editorial-prior');
  assert.equal(inegi.seed_liquidities.length, 2);
  assert.ok(inegi.seed_liquidities.every(n => Number(n) > 0));
});
