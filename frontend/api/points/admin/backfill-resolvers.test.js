/**
 * Static behavior checks for the generated-market retrofit endpoint.
 *
 * Run with:
 *   node --test frontend/api/points/admin/backfill-resolvers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./backfill-resolvers.js', import.meta.url), 'utf8');

test('retrofit endpoint backfills bilingual market translations', () => {
  assert.match(source, /attachMarketTranslations/);
  assert.match(source, /function backfillPendingMarketTranslations/);
  assert.match(source, /source_data->'translations'/);
  assert.match(source, /status IN \('pending', 'approved'\)/);
  assert.match(source, /translationCandidates/);
  assert.match(source, /translationsBackfilled/);
  assert.match(source, /patchCounts = \{ resolverType: 0, sport: 0, league: 0, outcomeImages: 0, translations: 0 \}/);
});

