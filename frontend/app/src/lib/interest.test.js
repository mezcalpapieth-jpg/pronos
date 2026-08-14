import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTEREST_DAILY_SIGNAL_CAP,
  interestDailyStorageKey,
  trackInterest,
} from './interest.js';

test('daily interest storage key ignores action so click and view do not double count', () => {
  const base = {
    surface: 'points',
    objectType: 'points_market',
    objectId: 'market-123',
  };

  const clickKey = interestDailyStorageKey({ ...base, action: 'click' }, new Date('2026-05-20T10:00:00Z'));
  const viewKey = interestDailyStorageKey({ ...base, action: 'view' }, new Date('2026-05-20T11:00:00Z'));
  const tomorrowKey = interestDailyStorageKey({ ...base, action: 'click' }, new Date('2026-05-21T10:00:00Z'));

  assert.equal(clickKey, viewKey);
  assert.notEqual(clickKey, tomorrowKey);
});

test('trackInterest allows five same-day object signals and caps the sixth', () => {
  const originalWindow = global.window;
  const originalNavigator = global.navigator;
  const originalFetch = global.fetch;
  const store = new Map();
  const sent = [];

  global.window = {
    localStorage: {
      getItem: key => store.get(key) || null,
      setItem: (key, value) => { store.set(key, String(value)); },
    },
    crypto: {
      randomUUID: () => 'client-1234567890abcdef',
    },
  };
  Object.defineProperty(global, 'navigator', {
    value: {},
    configurable: true,
  });
  global.fetch = (...args) => {
    sent.push(args);
    return Promise.resolve({ ok: true });
  };

  try {
    const payload = {
      surface: 'points',
      objectType: 'points_market',
      objectId: 'market-123',
      action: 'click',
    };

    for (let i = 0; i < INTEREST_DAILY_SIGNAL_CAP + 1; i += 1) {
      trackInterest(payload);
    }

    assert.equal(sent.length, INTEREST_DAILY_SIGNAL_CAP);
    assert.equal(store.get(interestDailyStorageKey(payload)), String(INTEREST_DAILY_SIGNAL_CAP));
  } finally {
    global.window = originalWindow;
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
    });
    global.fetch = originalFetch;
  }
});
