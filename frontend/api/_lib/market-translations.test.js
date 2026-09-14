import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachMarketTranslations,
  publicMarketTranslationFields,
  translateOutcomeLabel,
} from './market-translations.js';

test('attachMarketTranslations stores bilingual Netflix text', () => {
  const spec = attachMarketTranslations({
    question: '¿Lovesick entra al Top 3 de Netflix México esta semana?',
    outcomes: ['Sí', 'No'],
    source_data: {
      kind: 'netflix_top10',
      title: 'Lovesick',
      scope: 'mx',
    },
  });

  assert.equal(
    spec.source_data.translations.en.question,
    'Will Lovesick enter the Top 3 on Netflix Mexico this week?',
  );
  assert.deepEqual(spec.source_data.translations.en.outcomes, ['Yes', 'No']);
  assert.deepEqual(spec.source_data.translations.es.outcomes, ['Sí', 'No']);
});

test('attachMarketTranslations translates weather bucket markets', () => {
  const spec = attachMarketTranslations({
    question: '¿Temperatura máxima en Monterrey el 15/09/2026?',
    outcomes: ['Menos de 28°C', '28°C', '29°C', '30°C o más'],
    source_data: {
      cityLabel: 'Monterrey',
      forecastDateYmd: '2026-09-15',
    },
  });

  assert.equal(spec.source_data.translations.en.question, 'Max temperature in Monterrey on 15/09/2026?');
  assert.deepEqual(spec.source_data.translations.en.outcomes, ['Under 28°C', '28°C', '29°C', '30°C or more']);
});

test('sports matchup labels stay as team names when already language neutral', () => {
  const spec = attachMarketTranslations({
    question: 'San Francisco 49ers @ Los Angeles Rams',
    outcomes: ['Los Angeles Rams', 'San Francisco 49ers'],
    sport: 'nfl',
    league: 'nfl',
    source_data: { league: 'NFL' },
  });

  assert.equal(spec.source_data.translations.en.question, 'San Francisco 49ers @ Los Angeles Rams');
  assert.deepEqual(spec.source_data.translations.en.outcomes, ['Los Angeles Rams', 'San Francisco 49ers']);
});

test('publicMarketTranslationFields exposes frontend-friendly aliases', () => {
  const fields = publicMarketTranslationFields({
    question: '¿Quién gana Marlon Vera vs Sean OMalley?',
    outcomes: ['Marlon Vera', 'Sean OMalley'],
    sourceData: {},
  });

  assert.equal(fields.title, '¿Quién gana Marlon Vera vs Sean OMalley?');
  assert.equal(fields.title_en, 'Who wins Marlon Vera vs Sean OMalley?');
  assert.deepEqual(fields.outcomes_en, ['Marlon Vera', 'Sean OMalley']);
  assert.deepEqual(fields.options_en, [{ label: 'Marlon Vera' }, { label: 'Sean OMalley' }]);
});

test('translateOutcomeLabel falls back on common labels only', () => {
  assert.equal(translateOutcomeLabel('Empate', 'en'), 'Draw');
  assert.equal(translateOutcomeLabel('Otro actor', 'en'), 'Other actor');
  assert.equal(translateOutcomeLabel('Club América', 'en'), 'Club América');
});
