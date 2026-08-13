/**
 * Static behavior checks for the generated pending-markets admin API.
 *
 * Run with:
 *   node --test frontend/api/points/admin/pending-markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./pending-markets.js', import.meta.url), 'utf8');

test('rejected pending markets list newest reviewed rows first', () => {
  assert.match(
    source,
    /CASE\s+WHEN\s+p\.status\s*=\s*'rejected'\s+THEN\s+p\.reviewed_at\s+END\s+DESC\s+NULLS\s+LAST/,
  );
  assert.match(source, /p\.created_at\s+DESC/);
});

test('rejected pending markets can be re-added to the review queue', () => {
  assert.match(source, /action !== 'approve'\s*&& action !== 'reject'\s*&& action !== 'readd'\s*&& action !== 'edit'\s*&& action !== 'refresh_pricing'/);
  assert.match(source, /if \(action === 'readd'\)/);
  assert.match(source, /status\s*=\s*'pending'/);
  assert.match(source, /admin_note\s*=\s*COALESCE\(NULLIF\(\$2,\s*''\),\s*'manual-readded from rejected'\)/);
  assert.match(source, /reviewer\s*=\s*\$3/);
  assert.match(source, /reviewed_at\s*=\s*NOW\(\)/);
  assert.match(source, /approved_market_id\s*=\s*NULL/);
});

test('pending generated markets can be edited before approval', () => {
  assert.match(source, /if \(action === 'edit'\)/);
  assert.match(source, /async function editPending/);
  assert.match(source, /normalizeSeedLiquidities/);
  assert.match(source, /seed_liquidities/);
  assert.match(source, /MAX_PENDING_OUTCOMES\s*=\s*64/);
  assert.match(source, /normalizeOutcomeImagesForEdit/);
  assert.match(source, /outcomeImages:\s*parseJsonb\(r\.outcome_images,\s*null\)/);
  assert.match(source, /alignParallelResolverConfig/);
  assert.match(source, /resolver_config = \$11::jsonb/);
  assert.match(source, /source_data = \$12::jsonb/);
  assert.match(source, /syncMananeraPhraseFromQuestion/);
  assert.match(source, /syncApiPriceFromQuestion/);
  assert.match(source, /const sourceData = parseJsonb\(r\.source_data,\s*\{\}\)/);
  assert.match(source, /suggestedPricing:\s*sourceData\?\.suggestedPricing\s*\|\|\s*null/);
  assert.match(source, /pricingSearch:\s*sourceData\?\.pricingSearch\s*\|\|\s*null/);
  assert.match(source, /seedLiquidities:\s*parseJsonb\(r\.seed_liquidities,\s*null\)/);
  assert.match(source, /status !== 'pending'/);
});

test('pending generated markets support taxonomy filters and filtered bulk actions', () => {
  assert.match(source, /matchesMarketTaxonomy/);
  assert.match(source, /function filteredPendingRows/);
  assert.match(source, /query\.feature/);
  assert.match(source, /feature === 'featured' && row\.featured !== true/);
  assert.match(source, /feature === 'tournament' && row\.tournament_featured !== true/);
  assert.match(source, /filteredPendingRows\(rows,\s*req\.query/);
  assert.match(source, /async function listPendingRowsForBulk/);
  assert.match(source, /listPendingRowsForBulk\(filters\s*\|\|\s*\{\}\)/);
});

test('parallel pending approvals derive child Yes\\/No reserves from suggested probabilities', () => {
  assert.match(source, /seedLiquiditiesFromProbabilities/);
  assert.match(source, /function parallelLegBinaryReserves/);
  assert.match(source, /suggestedPricing\.legProbabilities/);
  assert.match(source, /suggestedPricing\.legProbabilityPct/);
  assert.match(source, /minProbability:\s*0\.01/);
  assert.match(source, /JSON\.stringify\(legReserves\)/);
});

test('legacy LCDLF binary nomination rows are auto-rejected after grouped market rollout', () => {
  assert.match(source, /LCDLF_SOURCE/);
  assert.match(source, /legacy LCDLF binary nominations replaced by grouped parallel market/);
  assert.match(source, /source_event_id ~ '\^lcdlf-mx-nomination:\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}:\.\+'/);
  assert.match(source, /COALESCE\(amm_mode, 'unified'\) <> 'parallel'/);
  assert.match(source, /AND \(reviewer IS NULL OR reviewer = 'system'\)/);
});

test('pending mañanera approval syncs transcript phrase from quoted question', () => {
  assert.match(source, /syncMananeraPhraseFromQuestion\(\{\s*question: r\.question,/);
  assert.match(source, /resolver_config = \$5::jsonb/);
  assert.match(source, /source_data = \$4::jsonb/);
});

test('pending api-price approval syncs edited threshold and operator from question', () => {
  assert.match(source, /syncApiPriceFromQuestion\(\{\s*question: r\.question,/);
  assert.match(source, /resolverConfig: syncedMananera\.resolverConfig/);
  assert.match(source, /sourceData: syncedMananera\.sourceData \|\| \{\}/);
  assert.match(source, /const sourceData = syncedApiPrice\.sourceData \|\| syncedMananera\.sourceData \|\| \{\}/);
  assert.match(source, /const resolverConfig = syncedApiPrice\.resolverConfig \|\| null/);
});

test('human re-added sports rows are not immediately auto-rejected again', () => {
  const overrideGuardCount = source.match(/AND \(reviewer IS NULL OR reviewer = 'system'\)/g)?.length || 0;
  assert.ok(overrideGuardCount >= 2);
});
