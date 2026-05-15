import test from 'node:test';
import assert from 'node:assert/strict';

import { generateNbaMarkets } from './nba.js';

function nbaEvent({ id, date, timeValid = true, shortDetail = '5/15 - 7:00 PM EDT', note = 'East Semifinals - Game 6' }) {
  return {
    id,
    name: 'Cleveland Cavaliers at Detroit Pistons',
    date,
    status: {
      type: {
        state: 'pre',
        shortDetail,
      },
    },
    competitions: [{
      timeValid,
      notes: [{ type: 'event', headline: note }],
      venue: { fullName: 'Little Caesars Arena' },
      competitors: [
        {
          homeAway: 'home',
          team: {
            id: '8',
            displayName: 'Detroit Pistons',
            abbreviation: 'DET',
            logo: 'det.png',
          },
        },
        {
          homeAway: 'away',
          team: {
            id: '5',
            displayName: 'Cleveland Cavaliers',
            abbreviation: 'CLE',
            logo: 'cle.png',
          },
        },
      ],
    }],
  };
}

test('NBA generator skips playoff games whose ESPN tipoff is still TBD', async () => {
  const originalFetch = globalThis.fetch;
  const realNow = Date.now();
  const confirmedTipoff = new Date(realNow + 36 * 3600_000).toISOString();
  const tbdTipoff = new Date(realNow + 48 * 3600_000).toISOString();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      events: [
        nbaEvent({ id: 'confirmed', date: confirmedTipoff }),
        nbaEvent({
          id: 'tbd',
          date: tbdTipoff,
          timeValid: false,
          shortDetail: 'TBD',
          note: 'East Semifinals - Game 7 If Necessary',
        }),
      ],
    }),
  });

  try {
    const specs = await generateNbaMarkets();
    assert.deepEqual(specs.map(s => s.source_event_id), ['confirmed']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
