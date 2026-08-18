import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./edit-market.js', import.meta.url), 'utf8');

test('active market edit syncs mañanera resolver phrase from quoted question', () => {
  assert.match(source, /syncMananeraPhraseFromQuestion/);
  assert.match(source, /question:\s*nextQuestion \?\? existing\.question/);
  assert.match(source, /resolverConfigChanged = syncedMananera\.changed === true \|\| syncedApiPrice\.changed === true/);
  assert.match(source, /&& !resolverConfigChanged/);
  assert.match(source, /resolver_config = \$\{nextResolverConfig \? JSON\.stringify\(nextResolverConfig\) : null\}::jsonb/);
});

test('active api-price market edits sync threshold and operator from question', () => {
  assert.match(source, /syncApiPriceFromQuestion/);
  assert.match(source, /resolverConfig: syncedMananera\.resolverConfig/);
  assert.match(source, /const nextResolverConfig = syncedApiPrice\.resolverConfig \|\| null/);
});

test('active market edit persists outcome image refs', () => {
  assert.match(source, /outcomeImages\?/);
  assert.match(source, /cleanOptionalImageRef/);
  assert.match(source, /hasOutcomeImagesPatch/);
  assert.match(source, /outcome_images_length_mismatch/);
  assert.match(source, /SET outcome_images = \$\{JSON\.stringify\(nextOutcomeImages\)\}::jsonb/);
  assert.match(source, /outcomeImages: r\.outcome_images/);
});

test('active parallel market edits can repair child reserves', () => {
  assert.match(source, /normalizeParallelLegPatches/);
  assert.match(source, /parallelLegs/);
  assert.match(source, /not_parallel_parent/);
  assert.match(source, /parallel_leg_not_active/);
  assert.match(source, /reserves = \$1::jsonb/);
  assert.match(source, /seed_liquidities = \$1::jsonb/);
  assert.match(source, /seed_liquidity = \$2/);
});
