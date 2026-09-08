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
  const now = new Date('2026-09-08T12:00:00Z');
  const kickoff = new Date(now.getTime() + 6 * 24 * 3600_000).toISOString();
  let capturedUrl = '';

  const specs = await generateNflMarkets({
    now,
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          season: { type: { type: 1, name: 'Preseason' } },
          events: [
            nflEvent({ id: '401873278', date: kickoff }),
            nflEvent({
              id: 'tbd',
              date: new Date(now.getTime() + 36 * 3600_000).toISOString(),
              timeValid: false,
              shortDetail: 'TBD',
            }),
          ],
        }),
      };
    },
  });

  assert.match(capturedUrl, /dates=20260908-20260915/);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].source, 'espn-nfl');
  assert.equal(specs[0].sport, 'nfl');
  assert.equal(specs[0].league, 'nfl');
  assert.equal(specs[0].question, 'Denver Broncos @ Atlanta Falcons');
  assert.equal(specs[0].source_data.matchupLabel, 'Denver Broncos @ Atlanta Falcons');
  assert.equal(specs[0].source_data.season, 'pretemporada NFL');
  assert.deepEqual(specs[0].outcomes, ['Atlanta Falcons', 'Denver Broncos']);
  assert.deepEqual(specs[0].outcome_images, ['atl.png', 'den.png']);
  assert.deepEqual(specs[0].resolver_config, {
    source: 'espn',
    leaguePath: 'football/nfl',
    eventId: '401873278',
    dateYmd: kickoff.slice(0, 10),
    shape: 'binary',
  });
});

test('NFL generator keeps visible title to matchup label during regular season', async () => {
  const now = new Date('2026-09-08T12:00:00Z');

  const specs = await generateNflMarkets({
    now,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        season: { type: { type: 2, name: 'Regular Season' } },
        events: [
          nflEvent({
            id: 'regular',
            date: new Date(now.getTime() + 24 * 3600_000).toISOString(),
            seasonType: 2,
            seasonSlug: 'regular-season',
          }),
        ],
      }),
    }),
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].question, 'Denver Broncos @ Atlanta Falcons');
  assert.doesNotMatch(specs[0].question, /¿|NFL|pretemporada/);
  assert.equal(specs[0].source_data.season, 'NFL');
});
