import assert from 'node:assert/strict';
import test from 'node:test';

const previousUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL ||= 'postgresql://unused:unused@localhost/unused';
const { pendingRowWithOpeningLiquidity } = await import('./pending-markets.js');
if (previousUrl === undefined) delete process.env.DATABASE_URL;

test('legacy pending rows show the same opening seeds used by single, bulk and automatic approvals', () => {
  const legacy = { status: 'pending', category: 'deportes', tournament_featured: false,
    outcomes: '["A","B","C"]', seed_liquidity: '1000', seed_liquidities: '[1000,1000,1000]',
    source_data: '{"evidence":"kept","suggestedPricing":{"probabilities":[0.333,0.333,0.334]}}' };
  const prepared = pendingRowWithOpeningLiquidity(legacy);
  assert.deepEqual(prepared.seed_liquidities, [7500,7500,7500]);
  assert.equal(prepared.source_data.evidence, 'kept');
  assert.deepEqual(prepared.source_data.suggestedPricing.probabilities, [0.333,0.333,0.334]);
  assert.deepEqual(pendingRowWithOpeningLiquidity(prepared), prepared);
  assert.deepEqual(pendingRowWithOpeningLiquidity({ ...legacy, category: 'crypto' }).seed_liquidities, [3750,3750,3750]);
  assert.deepEqual(pendingRowWithOpeningLiquidity({ ...legacy, amm_mode: 'parallel' }).seed_liquidities, [3750,3750,3750]);
  assert.deepEqual(pendingRowWithOpeningLiquidity({ ...legacy, seed_liquidities: '[1000,2000,3000]' }).seed_liquidities, [1000,2000,3000]);
  assert.deepEqual(pendingRowWithOpeningLiquidity({ ...legacy, status: 'approved' }).seed_liquidities, [1000,1000,1000]);
  assert.deepEqual(pendingRowWithOpeningLiquidity(legacy, { mode: 'onchain' }).seed_liquidities, [1000,1000,1000]);
  assert.equal(legacy.seed_liquidities, '[1000,1000,1000]');
});
