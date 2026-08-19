import assert from 'node:assert/strict';
import { test } from 'node:test';

import { translate } from './i18n.js';

test('points crypto hub copy translates between Spanish and English', () => {
  assert.equal(translate('points.crypto.kicker.past', 'es'), 'Cerrado');
  assert.equal(translate('points.crypto.kicker.past', 'en'), 'Past');
  assert.equal(translate('points.crypto.kicker.awaiting', 'es'), 'En espera');
  assert.equal(translate('points.crypto.kicker.awaiting', 'en'), 'Awaiting');
  assert.equal(translate('points.crypto.pendingHint', 'en'), 'Awaiting previous market. The threshold is published when this window opens, exactly as the previous one closes.');
});

test('points buy modal copy translates between Spanish and English', () => {
  assert.equal(translate('points.buy.title', 'es'), 'Comprar');
  assert.equal(translate('points.buy.title', 'en'), 'Buy');
  assert.equal(translate('points.buy.receivedShares', 'en'), 'Shares you receive');
  assert.equal(translate('points.buy.success', 'en'), 'Purchase complete');
});

test('points series game strip copy translates between Spanish and English', () => {
  assert.equal(translate('points.series.open', 'es'), 'Abierto');
  assert.equal(translate('points.series.open', 'en'), 'Open');
  assert.equal(translate('points.series.datePending', 'en'), 'Date pending');
});

test('points Mexico category uses Latam label', () => {
  assert.equal(translate('points.cat.mexico', 'es'), 'Mexico & Latam');
  assert.equal(translate('points.cat.mexico', 'en'), 'Mexico & Latam');
  assert.equal(translate('points.cat.infraestructura', 'es'), 'Infraestructura');
  assert.equal(translate('points.cat.infraestructura', 'en'), 'Infrastructure');
});

test('points public category filter labels translate region and climate copy', () => {
  assert.equal(translate('points.geo.world', 'es'), 'Mundo');
  assert.equal(translate('points.geo.world', 'en'), 'World');
  assert.equal(translate('points.topic.weather', 'es'), 'Clima');
  assert.equal(translate('points.topic.weather', 'en'), 'Weather');
});

test('legal page titles include app name in Spanish and English', () => {
  assert.equal(translate('legal.privacy.title', 'es'), 'Pronos Política de Privacidad');
  assert.equal(translate('legal.privacy.title', 'en'), 'Pronos Privacy Policy');
  assert.equal(translate('legal.terms.title', 'es'), 'Pronos Términos y Condiciones');
  assert.equal(translate('legal.terms.title', 'en'), 'Pronos Terms of Service');
  assert.equal(translate('legal.language.es', 'en'), 'Español');
  assert.equal(translate('legal.language.en', 'es'), 'English');
});
