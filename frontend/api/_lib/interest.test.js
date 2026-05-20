import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTEREST_DAILY_SIGNAL_CAP,
  INTEREST_SIGNAL_ACTION,
  INTEREST_WINDOWS,
  formatInterestRow,
  interestSignalActionForSlot,
  normalizeInterestClientId,
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

test('interest rows display unique daily signals instead of raw repeated presses', () => {
  const row = formatInterestRow({
    surface: 'points',
    object_type: 'team',
    object_id: 'soccer:cruz-azul',
    label: 'Cruz Azul',
    day_count: 8,
    week_count: 12,
    month_count: 20,
    lifetime_count: 40,
    day_unique: 1,
    week_unique: 3,
    month_unique: 5,
    lifetime_unique: 9,
    series: [
      { day: '2026-05-20', count: 8, unique: 1 },
    ],
  });

  assert.equal(row.counts.day, 1);
  assert.equal(row.counts.week, 3);
  assert.equal(row.counts.month, 5);
  assert.equal(row.counts.lifetime, 9);
  assert.equal(row.series[0].count, 1);
});

test('interest visitor identity supports object-level daily de-duping', () => {
  assert.equal(INTEREST_SIGNAL_ACTION, 'signal');
  assert.equal(INTEREST_DAILY_SIGNAL_CAP, 5);
  assert.equal(interestSignalActionForSlot(1), 'signal:1');
  assert.equal(interestSignalActionForSlot(5), 'signal:5');
  assert.equal(interestSignalActionForSlot(99), 'signal:5');
  assert.equal(normalizeInterestClientId('  abcdefghijklmnop  '), 'abcdefghijklmnop');
  assert.equal(normalizeInterestClientId('short'), null);
});
