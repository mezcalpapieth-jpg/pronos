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

test('NBA generator keeps US evening games after UTC rolls to the next day', async () => {
  const originalFetch = globalThis.fetch;
  const OriginalDate = globalThis.Date;
  const fixedNow = new OriginalDate('2026-05-16T00:30:00.000Z');
  let requestedUrl = '';

  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) return new OriginalDate(fixedNow);
      return new OriginalDate(...args);
    }

    static now() {
      return fixedNow.getTime();
    }
  };

  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        events: requestedUrl.includes('dates=20260515-20260528')
          ? [
              nbaEvent({
                id: 'late-us-evening',
                date: '2026-05-16T01:30:00.000Z',
                shortDetail: '5/15 - 9:30 PM EDT',
                note: 'West Semifinals - Game 6',
              }),
            ]
          : [
              nbaEvent({
                id: 'next-day-tbd',
                date: '2026-05-17T04:00:00.000Z',
                timeValid: false,
                shortDetail: 'TBD',
                note: 'West Semifinals - Game 7 If Necessary',
              }),
            ],
      }),
    };
  };

  try {
    const specs = await generateNbaMarkets();
    assert.match(requestedUrl, /dates=20260515-20260528/);
    assert.deepEqual(specs.map(s => s.source_event_id), ['late-us-evening']);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Date = OriginalDate;
  }
});
