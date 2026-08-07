import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./run-generators.js', import.meta.url), 'utf8');

test('runAllGenerators attaches suggested pricing to generated specs before upsert', () => {
  assert.match(source, /attachDefaultSuggestedPricing/);
  assert.match(source, /tryAttachPolymarketPricing/);
  assert.match(source, /attachMarketContextBlocks/);
  assert.match(source, /attachGeneratorPricing/);
  assert.match(source, /PRICING_CONCURRENCY/);
  assert.match(source, /await tryAttachPolymarketPricing\(specs\[index\]\)/);
  assert.match(source, /attachDefaultSuggestedPricing\(polymarketPriced\)/);
  assert.match(source, /pricedSpecs\.map\(spec => attachMarketContextBlocks\(spec\)\)/);
});

test('points pending upsert persists per-option seed liquidities', () => {
  assert.match(source, /seed_liquidity,\s*seed_liquidities/);
  assert.match(source, /\$\{s\.seed_liquidities \? JSON\.stringify\(s\.seed_liquidities\) : null\}::jsonb/);
  assert.match(source, /seed_liquidities\s*=\s*EXCLUDED\.seed_liquidities/);
});
