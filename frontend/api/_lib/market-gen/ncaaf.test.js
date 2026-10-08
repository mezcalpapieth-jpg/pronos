import test from 'node:test';
import assert from 'node:assert/strict';

import { generateNcaafMarkets } from './ncaaf.js';

function ncaafEvent({
  id,
  date,
  name = 'College Football Playoff Semifinal',
  seasonType = 3,
  seasonSlug = 'postseason',
  timeValid = true,
  state = 'pre',
  shortDetail = '12/31 - 8:00 PM EST',
  home = { id: '99', displayName: 'Georgia Bulldogs', abbreviation: 'UGA', logo: 'uga.png' },
  away = { id: '333', displayName: 'Alabama Crimson Tide', abbreviation: 'ALA', logo: 'ala.png' },
} = {}) {
  return {
    id,
    name,
    shortName: name,
    date,
    season: {
      year: 2026,
      type: seasonType,
      slug: seasonSlug,
    },
    status: {
      type: {
        state,
        shortDetail,
      },
    },
    competitions: [{
      timeValid,
      notes: [{ headline: name }],
      venue: { fullName: 'Rose Bowl', city: 'Pasadena', state: 'CA' },
      competitors: [
        { homeAway: 'home', team: home },
        { homeAway: 'away', team: away },
      ],
    }],
  };
}

test('NCAAF generator emits only scheduled bowl and CFP markets', async () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const kickoff = new Date('2026-12-31T23:00:00Z').toISOString();
  const regularKickoff = new Date('2026-12-06T20:00:00Z').toISOString();
  const capturedUrls = [];

  const specs = await generateNcaafMarkets({
    now,
    fetchImpl: async (url) => {
      capturedUrls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          season: { type: { type: 2, name: 'Regular Season' } },
          events: [
            ncaafEvent({ id: 'cfp-1', date: kickoff }),
            ncaafEvent({
              id: 'regular-1',
              date: regularKickoff,
              name: 'Iowa Hawkeyes at Washington Huskies',
              seasonType: 2,
              seasonSlug: 'regular-season',
            }),
            ncaafEvent({
              id: 'tbd-1',
              date: kickoff,
              name: 'Orange Bowl',
              timeValid: false,
              shortDetail: 'TBD',
            }),
          ],
        }),
      };
    },
  });

  assert.equal(capturedUrls.length, 46);
  assert.ok(capturedUrls.some(url => /football\/college-football\/scoreboard\?dates=20261201/.test(url)));
  assert.ok(capturedUrls.some(url => /football\/college-football\/scoreboard\?dates=20270115/.test(url)));
  assert.equal(capturedUrls.some(url => /dates=\d{8}-\d{8}/.test(url)), false);
  assert.equal(specs.length, 1);
  assert.equal(specs[0].source, 'espn-ncaaf');
  assert.equal(specs[0].sport, 'ncaaf');
  assert.equal(specs[0].league, 'ncaaf');
  assert.equal(specs[0].question, '¿Quién gana Alabama Crimson Tide @ Georgia Bulldogs?');
  assert.deepEqual(specs[0].outcomes, ['Georgia Bulldogs', 'Alabama Crimson Tide']);
  assert.deepEqual(specs[0].outcome_images, ['uga.png', 'ala.png']);
  assert.deepEqual(specs[0].resolver_config, {
    source: 'espn',
    leaguePath: 'football/college-football',
    eventId: 'cfp-1',
    dateYmd: kickoff.slice(0, 10),
    shape: 'binary',
  });
  assert.deepEqual(specs[0].source_data.suggestedPricing, {
    source: 'admin-config',
    probabilities: [0.5, 0.5],
    probabilityPct: [50, 50],
    seedLiquidities: [1000, 1000],
    rationale: 'NCAA football postseason binary matchup markets open balanced for admin review.',
    evidence: [],
  });
});
