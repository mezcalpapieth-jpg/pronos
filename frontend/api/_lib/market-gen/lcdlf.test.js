import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLcdlfMarkets } from './lcdlf.js';

test('generateLcdlfMarkets waits on nomination drafts when the current slate is visible', async () => {
  const previousResidents = process.env.LCDLF_RESIDENTS_JSON;
  const previousDiscover = process.env.LCDLF_DISCOVER_RESIDENTS;
  try {
    process.env.LCDLF_DISCOVER_RESIDENTS = 'false';
    process.env.LCDLF_RESIDENTS_JSON = JSON.stringify([
      { name: 'Ernesto Laguardia', slug: 'ernesto-laguardia' },
      { name: 'Memo Schutz', slug: 'memo-schutz' },
      { name: 'Yahir', slug: 'yahir' },
    ]);

    const fetchImpl = async (url) => {
      let label = 'EN CASA';
      if (String(url).includes('/habitantes/ernesto-laguardia')) label = 'NOMINADO';
      if (String(url).includes('/habitantes/memo-schutz')) label = 'NOMINADO';
      return {
        ok: true,
        status: 200,
        text: async () => `<html><body><span>${label}</span></body></html>`,
      };
    };

    const specs = await generateLcdlfMarkets({
      now: new Date('2026-08-10T12:00:00Z'),
      fetchImpl,
    });

    assert.equal(specs.length, 1);
    const nomination = specs.find(spec => String(spec.source_event_id).startsWith('lcdlf-mx-nomination:'));
    const elimination = specs.find(spec => String(spec.source_event_id).startsWith('lcdlf-mx-elimination:'));

    assert.equal(nomination, undefined);
    assert.ok(elimination);
    assert.equal(elimination.source, 'lcdlf-official');
    assert.deepEqual(elimination.outcomes, ['Ernesto Laguardia', 'Memo Schutz']);
    assert.deepEqual(elimination.seed_liquidities, [1000, 1000]);
    assert.equal(elimination.source_data.suggestedPricing.source, 'lcdlf-official:nominated');
    assert.equal(elimination.resolver_type, 'api_lcdlf');
    assert.equal(elimination.resolver_config.shape, 'parallel-status');
    assert.equal(elimination.resolver_config.statusKey, 'eliminado');
    assert.equal(elimination.resolver_config.closeOnStatus, false);

  } finally {
    if (previousResidents === undefined) delete process.env.LCDLF_RESIDENTS_JSON;
    else process.env.LCDLF_RESIDENTS_JSON = previousResidents;
    if (previousDiscover === undefined) delete process.env.LCDLF_DISCOVER_RESIDENTS;
    else process.env.LCDLF_DISCOVER_RESIDENTS = previousDiscover;
  }
});

test('generateLcdlfMarkets creates one nested nomination market from active residents before official nominees appear', async () => {
  const previousResidents = process.env.LCDLF_RESIDENTS_JSON;
  const previousDiscover = process.env.LCDLF_DISCOVER_RESIDENTS;
  try {
    process.env.LCDLF_DISCOVER_RESIDENTS = 'false';
    process.env.LCDLF_RESIDENTS_JSON = JSON.stringify([
      { name: 'Fede Vigevani', slug: 'fede-vigevani' },
      { name: 'Brianda Deyanara', slug: 'brianda-deyanara' },
      { name: 'Flor Vigna', slug: 'flor-vigna' },
    ]);

    const fetchImpl = async (url) => {
      let label = '';
      if (String(url).includes('/habitantes/fede-vigevani')) label = 'ELIMINADO';
      if (String(url).includes('/habitantes/brianda-deyanara')) label = 'LÍDER DE LA SEMANA';
      return {
        ok: true,
        status: 200,
        text: async () => `<html><body><span>${label}</span></body></html>`,
      };
    };

    const specs = await generateLcdlfMarkets({
      now: new Date('2026-08-12T18:00:00Z'),
      fetchImpl,
    });

    assert.equal(specs.length, 1);
    assert.equal(specs[0].resolver_type, 'api_lcdlf');
    assert.equal(specs[0].amm_mode, 'parallel');
    assert.equal(specs[0].resolver_config.shape, 'parallel-status');
    assert.deepEqual(specs[0].outcomes, ['Brianda Deyanara', 'Flor Vigna']);
    assert.equal(specs[0].end_time, '2026-08-13T03:55:00.000Z');
    assert.deepEqual(specs[0].resolver_config.legs.map(leg => leg.residentSlug), ['brianda-deyanara', 'flor-vigna']);
    assert.equal(specs[0].source_data.suggestedPricing.source, 'lcdlf-official:active-resident');
    assert.deepEqual(specs[0].source_data.suggestedPricing.legProbabilityPct, [32, 32]);
  } finally {
    if (previousResidents === undefined) delete process.env.LCDLF_RESIDENTS_JSON;
    else process.env.LCDLF_RESIDENTS_JSON = previousResidents;
    if (previousDiscover === undefined) delete process.env.LCDLF_DISCOVER_RESIDENTS;
    else process.env.LCDLF_DISCOVER_RESIDENTS = previousDiscover;
  }
});
