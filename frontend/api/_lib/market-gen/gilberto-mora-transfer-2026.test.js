import test from 'node:test';
import assert from 'node:assert/strict';

import {
  _internal,
  generateGilbertoMoraTransfer2026Markets,
} from './gilberto-mora-transfer-2026.js';

test('Gilberto Mora generator creates one manual parallel transfer market', async () => {
  const specs = await generateGilbertoMoraTransfer2026Markets();
  assert.equal(specs.length, 1);

  const [spec] = specs;
  assert.equal(spec.source, _internal.SOURCE);
  assert.equal(spec.source_event_id, _internal.SOURCE_EVENT_ID);
  assert.equal(spec.question, '¿Qué club anunciará el fichaje de Gilberto Mora antes del 1 de noviembre de 2026?');
  assert.equal(spec.category, 'deportes');
  assert.equal(spec.sport, 'soccer');
  assert.equal(spec.league, 'transfers');
  assert.equal(spec.end_time, _internal.CLOSE_ISO);
  assert.equal(spec.amm_mode, 'parallel');
  assert.equal(spec.resolver_type, 'manual');
  assert.equal(spec.featured, true);
  assert.equal(spec.tournament_featured, true);
  assert.equal(spec.is_test_market, undefined);
});

test('Gilberto Mora outcomes put Liverpool first and Mexico-stay last', async () => {
  const [spec] = await generateGilbertoMoraTransfer2026Markets();

  assert.deepEqual(spec.outcomes, [
    'Liverpool',
    'Real Madrid',
    'Barcelona',
    'Borussia Dortmund',
    'Benfica',
    'Paris Saint-Germain',
    'Bayern Munich',
    'Otro club europeo',
    'Sigue en México después del 31 de octubre',
  ]);
  assert.equal(spec.resolver_config.legs.length, spec.outcomes.length);
  assert.equal(spec.resolver_config.legs[0].slug, 'liverpool');
  assert.equal(spec.resolver_config.legs.at(-1).slug, 'stays-in-mexico');
});

test('Gilberto Mora market carries evidence, translations, and editorial pricing', async () => {
  const [spec] = await generateGilbertoMoraTransfer2026Markets();

  assert.equal(spec.source_data.evidence.length, 4);
  assert.deepEqual(spec.source_data.sourceUrls, spec.source_data.evidence.map(item => item.url));
  assert.match(spec.source_data.resolutionCriteria, /Sigue en Mexico despues del 31 de octubre/);
  assert.match(spec.resolver_config.criteria, /Rumores, reportes sin anuncio oficial/);
  assert.equal(
    spec.source_data.translations.en.question,
    'Which club will announce the signing of Gilberto Mora before November 1, 2026?',
  );
  assert.equal(spec.source_data.translations.en.outcomes.at(-1), 'Stays in Mexico after October 31');
  assert.equal(spec.source_data.suggestedPricing.source, 'admin-config');
  assert.equal(spec.source_data.suggestedPricing.probabilities.length, spec.outcomes.length);
  assert.equal(
    Math.round(spec.source_data.suggestedPricing.probabilities.reduce((sum, value) => sum + value, 0) * 100),
    100,
  );
  assert.deepEqual(spec.source_data.categorization.categoryTags, ['deportes', 'mexico']);
  assert.deepEqual(spec.source_data.categorization.geoTags, ['mexico', 'world']);
});
