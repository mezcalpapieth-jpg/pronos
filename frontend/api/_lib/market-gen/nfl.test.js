import test from 'node:test';
import assert from 'node:assert/strict';

import { generateNflMarkets } from './nfl.js';

function nflEvent({
  id,
  date,
  seasonType = 1,
  seasonSlug = 'preseason',
  timeValid = true,
  shortDetail = '8/14 - 7:00 PM EDT',
}) {
  return {
    id,
    date,
    season: {
      year: 2026,
      type: seasonType,
      slug: seasonSlug,
    },
    week: { number: 2 },
    status: {
      type: {
        state: 'pre',
        shortDetail,
      },
    },
    competitions: [{
      timeValid,
      venue: { fullName: 'Mercedes-Benz Stadium' },
      competitors: [
        {
          homeAway: 'home',
          team: {
            id: '1',
            displayName: 'Atlanta Falcons',
            abbreviation: 'ATL',
            logo: 'atl.png',
          },
        },
        {
          homeAway: 'away',
          team: {
            id: '7',
            displayName: 'Denver Broncos',
            abbreviation: 'DEN',
            logo: 'den.png',
          },
        },
      ],
    }],
  };
}

test('NFL generator emits preseason ESPN binary markets', async () => {
  const originalFetch = globalThis.fetch;
  const kickoff = new Date(Date.now() + 24 * 3600_000).toISOString();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      season: { type: { type: 1, name: 'Preseason' } },
      events: [
        nflEvent({ id: '401873278', date: kickoff }),
        nflEvent({
          id: 'tbd',
          date: new Date(Date.now() + 36 * 3600_000).toISOString(),
          timeValid: false,
          shortDetail: 'TBD',
        }),
      ],
    }),
  });

  try {
    const specs = await generateNflMarkets();
    assert.equal(specs.length, 1);
    assert.equal(specs[0].source, 'espn-nfl');
    assert.equal(specs[0].sport, 'nfl');
    assert.equal(specs[0].league, 'nfl');
    assert.match(specs[0].question, /pretemporada NFL/);
    assert.deepEqual(specs[0].outcomes, ['Atlanta Falcons', 'Denver Broncos']);
    assert.deepEqual(specs[0].outcome_images, ['atl.png', 'den.png']);
    assert.deepEqual(specs[0].resolver_config, {
      source: 'espn',
      leaguePath: 'football/nfl',
      eventId: '401873278',
      dateYmd: kickoff.slice(0, 10),
      shape: 'binary',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('NFL generator labels regular season without preseason copy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      season: { type: { type: 2, name: 'Regular Season' } },
      events: [
        nflEvent({
          id: 'regular',
          date: new Date(Date.now() + 24 * 3600_000).toISOString(),
          seasonType: 2,
          seasonSlug: 'regular-season',
        }),
      ],
    }),
  });

  try {
    const specs = await generateNflMarkets();
    assert.equal(specs.length, 1);
    assert.match(specs[0].question, /en NFL\?$/);
    assert.doesNotMatch(specs[0].question, /pretemporada/);
    assert.equal(specs[0].source_data.season, 'NFL');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
