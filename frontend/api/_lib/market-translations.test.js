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

test('manual Mexico seismic markets translate without generator metadata', () => {
  const alertFields = publicMarketTranslationFields({
    question: 'Se activará la alerta sísmica en la Ciudad de México durante el mes de septiembre de 2026?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(
    alertFields.title_en,
    'Will the seismic alert be activated in Mexico City during September 2026?',
  );
  assert.deepEqual(alertFields.outcomes_en, ['Yes', 'No']);

  const quakeFields = publicMarketTranslationFields({
    question: 'Registrará la Ciudad de México un sismo de magnitud 6.0 o mayor durante septiembre 2026?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(
    quakeFields.title_en,
    'Will Mexico City record an earthquake of magnitude 6.0 or higher during September 2026?',
  );
});

test('crypto direction and long-window manual markets translate without source data', () => {
  const rapidFields = publicMarketTranslationFields({
    question: 'Bitcoin: ¿sube o baja a las 13:25 CDMX?',
    outcomes: ['SUBE', 'BAJA'],
  });
  assert.equal(rapidFields.title_en, 'Bitcoin: higher or lower at 13:25 CDMX?');
  assert.deepEqual(rapidFields.outcomes_en, ['UP', 'DOWN']);

  const btcFields = publicMarketTranslationFields({
    question: '¿Bitcoin cerrará el año arriba de 100 mil dólares?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(btcFields.title_en, 'Will Bitcoin close the year above 100K dollars?');

  const ethFields = publicMarketTranslationFields({
    question: '¿Ethereum superará los 5 mil dólares antes de que acabe el trimestre?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(
    ethFields.title_en,
    'Will Ethereum pass 5K dollars before the end of the quarter?',
  );
});

test('manual world-politics markets translate common Spanish question shapes', () => {
  const fifaFields = publicMarketTranslationFields({
    question: '¿Gianni Infantino renuncia como presidente de FIFA antes de octubre de 2026?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(
    fifaFields.title_en,
    'Will Gianni Infantino resign as FIFA president before October 2026?',
  );

  const fedFields = publicMarketTranslationFields({
    question: '¿La Fed sube la tasa en la reunión del 16 de septiembre de 2026?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(fedFields.title_en, 'Will the Fed raise rates at the September 16, 2026 meeting?');
});

test('mañanera word markets identify the president of Mexico in English', () => {
  const mentionFields = publicMarketTranslationFields({
    question: '¿La presidenta mencionará "huachicol" en la mañanera del 15 de septiembre de 2026?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(
    mentionFields.title_en,
    'Will the president of Mexico mention "huachicol" in the morning press conference on September 15, 2026?',
  );

  const countFields = publicMarketTranslationFields({
    question: '¿La presidenta dirá "aranceles" 3 o más veces en la mañanera del 16 de septiembre de 2026?',
    outcomes: ['Sí', 'No'],
  });
  assert.equal(
    countFields.title_en,
    'Will the president of Mexico say "aranceles" 3 or more times in the morning press conference on September 16, 2026?',
  );
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
