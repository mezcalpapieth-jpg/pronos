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
  assert.match(source, /p\.status = 'pending'/);
  assert.match(source, /p\.end_time IS NULL OR p\.end_time > NOW\(\)/);
  assert.match(source, /p\.status = 'approved'/);
  assert.match(source, /m\.status = 'active'/);
  assert.match(source, /m\.parent_id IS NULL/);
  assert.match(source, /m\.archived_at IS NULL/);
  assert.match(source, /translationCandidates/);
  assert.match(source, /translationsBackfilled/);
  assert.match(source, /patchCounts = \{ resolverType: 0, sport: 0, league: 0, outcomeImages: 0, translations: 0 \}/);
  assert.match(source, /patchCounts\.translations = translations\.updatedCount/);
  assert.doesNotMatch(source, /record\(row\.approved_market_id,\s*'translations'\)/);
});

test('retrofit endpoint can force-sync the approved INPC resolver upgrade', () => {
  assert.match(source, /generateOctoberTournament2026Markets/);
  assert.match(source, /FORCE_RESOLVER_SYNC_SOURCE_EVENT_IDS/);
  assert.match(source, /october-2026:inpc-first-half-october-annual-inflation/);
  assert.match(source, /function shouldForceResolverSync/);
  assert.match(source, /m\.resolver_type IS DISTINCT FROM \$\{s\.resolver_type \|\| null\}::text/);
  assert.match(source, /m\.resolver_config IS DISTINCT FROM \$\{s\.resolver_config \? JSON\.stringify\(s\.resolver_config\) : null\}::jsonb/);
});
