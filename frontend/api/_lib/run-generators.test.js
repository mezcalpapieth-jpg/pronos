import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./run-generators.js', import.meta.url), 'utf8');

test('runAllGenerators attaches suggested pricing to generated specs before upsert', () => {
  assert.match(source, /attachDefaultSuggestedPricing/);
  assert.match(source, /tryAttachPolymarketPricing/);
  assert.match(source, /attachMarketContextBlocks/);
  assert.match(source, /attachGeneratorPricing/);
  assert.match(source, /export async function prepareGeneratedSpecs/);
  assert.match(source, /PRICING_CONCURRENCY/);
  assert.match(source, /await tryAttachPolymarketPricing\(specs\[index\]\)/);
  assert.match(source, /attachDefaultSuggestedPricing\(polymarketPriced\)/);
  assert.match(source, /return pricedSpecs\.map\(spec => attachMarketContextBlocks\(spec\)\)/);
  assert.match(source, /const contextualSpecs = await prepareGeneratedSpecs\(specs\)/);
});

test('points pending upsert persists per-option seed liquidities', () => {
  assert.match(source, /seed_liquidity,\s*seed_liquidities/);
  assert.match(source, /\$\{s\.seed_liquidities \? JSON\.stringify\(s\.seed_liquidities\) : null\}::jsonb/);
  assert.match(source, /seed_liquidities\s*=\s*EXCLUDED\.seed_liquidities/);
});

test('generator runner can sync approved ATP H2H schedule changes', () => {
  assert.match(source, /APPROVED_SCHEDULE_SYNC_SOURCES[\s\S]*espn-atp-match/);
  assert.match(source, /export async function syncApprovedMarketSchedules/);
  assert.match(source, /UPDATE points_markets m[\s\S]*SET end_time = \$\{s\.end_time\}::timestamptz/);
  assert.match(source, /UPDATE points_pending_markets[\s\S]*resolver_config = \$\{freshResolverConfig\}::jsonb/);
});
