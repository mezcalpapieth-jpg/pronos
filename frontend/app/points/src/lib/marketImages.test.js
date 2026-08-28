import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanMarketImageRef,
  marketImageSrc,
  marketPlaceholderImageSrc,
  marketPlaceholderKey,
} from './marketImages.js';

test('market image refs allow external images and safe local placeholder paths', () => {
  assert.equal(cleanMarketImageRef('https://example.com/market.png'), 'https://example.com/market.png');
  assert.equal(cleanMarketImageRef('/market-placeholders/deportes.svg'), '/market-placeholders/deportes.svg');
  assert.equal(cleanMarketImageRef('/../secret.png'), null);
  assert.equal(cleanMarketImageRef('javascript:alert(1)'), null);
});

test('market image helper falls back to category and special placeholders', () => {
  assert.equal(marketPlaceholderKey({ category: 'deportes' }), 'deportes');
  assert.equal(marketPlaceholderKey({ category: 'general', question: 'Retrasos AICM mañana' }), 'aicm');
  assert.equal(marketPlaceholderKey({ category: 'mexico', topicTags: ['weather'] }), 'weather');
  assert.equal(marketPlaceholderImageSrc({ category: 'finanzas' }), '/market-placeholders/finanzas.svg');
  assert.equal(marketImageSrc({ imageUrl: '', category: 'crypto' }), '/market-placeholders/crypto.svg');
});
