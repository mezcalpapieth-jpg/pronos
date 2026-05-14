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
