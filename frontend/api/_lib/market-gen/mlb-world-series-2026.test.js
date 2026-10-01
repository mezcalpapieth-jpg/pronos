import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _internal,
  generateMlbWorldSeries2026Markets,
} from './mlb-world-series-2026.js';

test('World Series generator creates one manual parallel winner market', async () => {
  const specs = await generateMlbWorldSeries2026Markets();
  assert.equal(specs.length, 1);

  const [spec] = specs;
  assert.equal(spec.source, _internal.SOURCE);
  assert.equal(spec.source_event_id, _internal.SOURCE_EVENT_ID);
  assert.equal(spec.question, '¿Quién ganará la Serie Mundial de MLB 2026?');
  assert.equal(spec.category, 'deportes');
  assert.equal(spec.sport, 'baseball');
  assert.equal(spec.league, 'mlb');
  assert.equal(spec.end_time, _internal.CLOSE_ISO);
  assert.equal(spec.amm_mode, 'parallel');
  assert.equal(spec.resolver_type, 'manual');
  assert.equal(spec.featured, true);
  assert.equal(spec.tournament_featured, true);
  assert.equal(spec.is_test_market, undefined);
});

test('World Series market includes every team still alive before PHI/ATL Game 3', async () => {
  const [spec] = await generateMlbWorldSeries2026Markets();

  assert.deepEqual(spec.outcomes, [
    'Cleveland Guardians',
    'Chicago White Sox',
    'Tampa Bay Rays',
    'New York Yankees',
    'Milwaukee Brewers',
    'San Diego Padres',
    'Los Angeles Dodgers',
    'Philadelphia Phillies',
    'Atlanta Braves',
  ]);
  assert.equal(spec.outcome_images.length, spec.outcomes.length);
  assert.equal(spec.resolver_config.legs.length, spec.outcomes.length);
  assert.ok(spec.resolver_config.legs.some(leg => leg.abbr === 'PHI'));
  assert.ok(spec.resolver_config.legs.some(leg => leg.abbr === 'ATL'));
});

test('World Series market carries source evidence, translations, and uniform pricing', async () => {
  const [spec] = await generateMlbWorldSeries2026Markets();

  assert.equal(spec.source_data.evidence.length, 3);
  assert.deepEqual(spec.source_data.sourceUrls, spec.source_data.evidence.map(item => item.url));
  assert.match(spec.source_data.resolutionCriteria, /MLB declare campeon oficial/);
  assert.equal(spec.source_data.translations.en.question, 'Who will win the 2026 MLB World Series?');
  assert.deepEqual(spec.source_data.translations.en.outcomes, spec.outcomes);
  assert.equal(spec.source_data.suggestedPricing.source, 'admin-config');
  assert.equal(spec.source_data.suggestedPricing.probabilities.length, spec.outcomes.length);
  assert.ok(spec.source_data.suggestedPricing.probabilities.every(value => value === 1 / spec.outcomes.length));
  assert.deepEqual(spec.source_data.categorization.categoryTags, ['deportes']);
  assert.deepEqual(spec.source_data.categorization.geoTags, ['world']);
});
