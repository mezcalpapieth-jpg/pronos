import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTEREST_WINDOWS,
  normalizeInterestPayload,
  sanitizeInterestMetadata,
} from './interest.js';

test('interest payload allows daily team clicks and rejects unknown actions', () => {
  const payload = normalizeInterestPayload({
    surface: 'mvp',
    objectType: 'team',
    objectId: 'soccer:arsenal',
    action: 'click',
    metadata: {
      label: 'Arsenal',
      league: 'Premier League',
      ignored: 'x'.repeat(500),
    },
  });

  assert.equal(payload.surface, 'mvp');
  assert.equal(payload.objectType, 'team');
  assert.equal(payload.objectId, 'soccer:arsenal');
  assert.equal(payload.action, 'click');
  assert.equal(payload.metadata.label, 'Arsenal');
  assert.equal(payload.metadata.league, 'Premier League');
  assert.equal(payload.metadata.ignored, undefined);

  assert.throws(() => normalizeInterestPayload({
    surface: 'mvp',
    objectType: 'team',
    objectId: 'soccer:arsenal',
    action: 'hover',
  }), /invalid_action/);
});

test('interest windows expose day week month and lifetime rollups', () => {
  assert.deepEqual(INTEREST_WINDOWS.map(w => w.key), ['day', 'week', 'month', 'lifetime']);
  assert.equal(INTEREST_WINDOWS.find(w => w.key === 'day')?.label, 'Hoy');
  assert.equal(INTEREST_WINDOWS.find(w => w.key === 'lifetime')?.label, 'Vida');
});

test('interest metadata is bounded to admin-safe fields', () => {
  assert.deepEqual(sanitizeInterestMetadata({
    label: 'PSG vs Arsenal',
    question: '¿Quién gana?',
    sport: 'soccer',
    league: 'uefa-cl',
    country: 'Francia',
    category: 'deportes',
    status: 'active',
    source: 'football-data.org',
    secret: 'nope',
  }), {
    label: 'PSG vs Arsenal',
    question: '¿Quién gana?',
    sport: 'soccer',
    league: 'uefa-cl',
    country: 'Francia',
    category: 'deportes',
    status: 'active',
    source: 'football-data.org',
  });
});
