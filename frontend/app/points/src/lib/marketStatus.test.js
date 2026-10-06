import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CLOSING_SOON_MS,
  isClosingSoonNonSportsMarket,
  isSportsMarket,
} from './marketStatus.js';

const now = new Date('2026-10-06T12:00:00.000Z');

test('detects sports markets from category, sport, or tags', () => {
  assert.equal(isSportsMarket({ category: 'deportes' }), true);
  assert.equal(isSportsMarket({ category: 'general', sport: 'baseball' }), true);
  assert.equal(isSportsMarket({ category: 'general', topicTags: ['deportes'] }), true);
  assert.equal(isSportsMarket({ category: 'mexico', topicTags: ['weather'] }), false);
});

test('marks non-sports active markets as closing soon inside the final 12 hours', () => {
  assert.equal(isClosingSoonNonSportsMarket({
    category: 'mexico',
    status: 'active',
    endTime: new Date(now.getTime() + CLOSING_SOON_MS).toISOString(),
  }, now), true);

  assert.equal(isClosingSoonNonSportsMarket({
    category: 'mexico',
    status: 'active',
    endTime: new Date(now.getTime() + CLOSING_SOON_MS + 1).toISOString(),
  }, now), false);

  assert.equal(isClosingSoonNonSportsMarket({
    category: 'deportes',
    status: 'active',
    endTime: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
  }, now), false);
});
