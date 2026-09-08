import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildInvalidParallelLegPlan,
  normalizeInvalidLegLabel,
  normalizeInvalidParallelLegRequest,
} from './points-invalid-parallel-leg.js';

test('normalizeInvalidLegLabel compares accent and punctuation variants', () => {
  assert.equal(normalizeInvalidLegLabel('  Flor Vigna!! '), 'flor vigna');
  assert.equal(normalizeInvalidLegLabel('Nominadá inválida'), 'nominada invalida');
});

test('normalizeInvalidParallelLegRequest accepts child id or parent plus label', () => {
  assert.deepEqual(normalizeInvalidParallelLegRequest({
    legMarketId: '161983',
    reason: '',
  }), {
    marketId: 161983,
    parentMarketId: null,
    legLabel: '',
    reason: 'Reembolso: nominada inválida',
  });
  assert.deepEqual(normalizeInvalidParallelLegRequest({
    parentId: '161979',
    legLabel: 'Flor Vigna',
    reason: 'Reembolso: participante inválida',
  }), {
    marketId: null,
    parentMarketId: 161979,
    legLabel: 'Flor Vigna',
    reason: 'Reembolso: participante inválida',
  });
  assert.deepEqual(normalizeInvalidParallelLegRequest({ legLabel: 'Flor Vigna' }), {
    error: 'invalid_leg_selector',
  });
});

test('invalid parallel leg plan removes only the selected option and aligns parent metadata', () => {
  const plan = buildInvalidParallelLegPlan({
    parent: {
      id: 161979,
      question: '¿Quién quedará nominado/a en La Casa de los Famosos México esta semana?',
      outcomes: ['Cynthia Klitbo', 'Yahir', 'Flor Vigna', 'Gema Garoa'],
      outcome_images: ['cynthia.png', 'yahir.png', 'flor.png', 'gema.png'],
      seed_liquidity: 1000,
      resolver_config: {
        source: 'lcdlf-official',
        shape: 'parallel',
        legs: [
          { label: 'Cynthia Klitbo', slug: 'cynthia-klitbo' },
          { label: 'Yahir', slug: 'yahir' },
          { label: 'Flor Vigna', slug: 'flor-vigna' },
          { label: 'Gema Garoa', slug: 'gema-garoa' },
        ],
      },
    },
    children: [
      { id: 161980, leg_label: 'Cynthia Klitbo', status: 'active', seed_liquidity: 1000 },
      { id: 161981, leg_label: 'Yahir', status: 'active', seed_liquidity: 1100 },
      { id: 161982, leg_label: 'Flor Vigna', status: 'active', seed_liquidity: 900 },
      { id: 161983, leg_label: 'Gema Garoa', status: 'active', seed_liquidity: 1200 },
    ],
    targetChildIds: [161982],
    refundRows: [
      { market_id: 161982, username: 'user-a', amount: '2500' },
      { market_id: 161982, username: 'user-b', amount: '2100' },
    ],
    reason: 'Reembolso: nominada inválida',
    adminUsername: 'admin',
    nowIso: '2026-09-08T18:00:00.000Z',
  });

  assert.deepEqual(plan.invalidChildren.map(row => row.leg_label), ['Flor Vigna']);
  assert.deepEqual(plan.outcomes, ['Cynthia Klitbo', 'Yahir', 'Gema Garoa']);
  assert.deepEqual(plan.outcomeImages, ['cynthia.png', 'yahir.png', 'gema.png']);
  assert.deepEqual(plan.seedLiquidities, [1000, 1100, 1200]);
  assert.deepEqual(plan.resolverConfig.legs.map(leg => leg.label), ['Cynthia Klitbo', 'Yahir', 'Gema Garoa']);
  assert.deepEqual(plan.sourceDataPatch.parallelLegVoid.labels, ['Flor Vigna']);
  assert.equal(plan.refundCount, 2);
  assert.equal(plan.totalRefunded, 4600);
});

test('invalid parallel leg implementation writes targeted refund audit rows', () => {
  const source = fs.readFileSync(new URL('./points-invalid-parallel-leg.js', import.meta.url), 'utf8');
  const routeSource = fs.readFileSync(new URL('../points/admin/void-invalid-parallel-leg.js', import.meta.url), 'utf8');
  assert.match(source, /invalid_field_refund/);
  assert.match(source, /releaseOpenLimitOrdersForMarkets/);
  assert.match(source, /Reembolso: nominada inválida/);
  assert.match(source, /UPDATE points_pending_markets/);
  assert.match(routeSource, /requirePointsAdmin/);
  assert.match(routeSource, /dryRun = req\.body\?\.dryRun !== false/);
});
