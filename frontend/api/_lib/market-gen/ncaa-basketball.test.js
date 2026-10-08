import test from 'node:test';
import assert from 'node:assert/strict';

import { generateNcaaBasketballMarkets } from './ncaa-basketball.js';

function basketballEvent({
  id,
  date,
  name = "NCAA Men's Basketball Championship - First Round",
  state = 'pre',
  timeValid = true,
  shortDetail = '3/19 - 7:00 PM EDT',
  home = { id: '57', displayName: 'Kansas Jayhawks', abbreviation: 'KU', logo: 'ku.png' },
  away = { id: '41', displayName: 'Connecticut Huskies', abbreviation: 'CONN', logo: 'conn.png' },
} = {}) {
  return {
    id,
    name,
    shortName: name,
    date,
    season: {
      year: 2027,
      type: 3,
      slug: 'postseason',
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
      venue: { fullName: 'United Center', city: 'Chicago', state: 'IL' },
      competitors: [
        { homeAway: 'home', team: home },
        { homeAway: 'away', team: away },
      ],
    }],
  };
}

test('NCAA basketball generator emits mens and womens March Madness markets only', async () => {
  const now = new Date('2027-03-15T12:00:00Z');
  const kickoff = new Date('2027-03-19T23:00:00Z').toISOString();
  const capturedUrls = [];

  const specs = await generateNcaaBasketballMarkets({
    now,
    fetchImpl: async (url) => {
      capturedUrls.push(String(url));
      const isWomen = String(url).includes('womens-college-basketball');
      return {
        ok: true,
        json: async () => ({
          season: { type: { type: 3, name: 'Postseason' } },
          events: [
            basketballEvent({
              id: isWomen ? 'w-1' : 'm-1',
              date: kickoff,
              name: isWomen
                ? "NCAA Women's Basketball Championship - First Round"
                : "NCAA Men's Basketball Championship - First Round",
              home: isWomen
                ? { id: '99', displayName: 'South Carolina Gamecocks', abbreviation: 'SC', logo: 'sc.png' }
                : { id: '57', displayName: 'Kansas Jayhawks', abbreviation: 'KU', logo: 'ku.png' },
              away: isWomen
                ? { id: '150', displayName: 'UConn Huskies', abbreviation: 'CONN', logo: 'uconn.png' }
                : { id: '41', displayName: 'Connecticut Huskies', abbreviation: 'CONN', logo: 'conn.png' },
            }),
            basketballEvent({
              id: isWomen ? 'w-conf' : 'm-conf',
              date: kickoff,
              name: 'Big 12 Championship',
            }),
            basketballEvent({
              id: isWomen ? 'w-tbd' : 'm-tbd',
              date: kickoff,
              name: 'Final Four',
              timeValid: false,
              shortDetail: 'TBD',
            }),
          ],
        }),
      };
    },
  });

  assert.equal(capturedUrls.length, 50);
  assert.ok(capturedUrls.some(url => url.includes('mens-college-basketball/scoreboard?dates=20270315')));
  assert.ok(capturedUrls.some(url => url.includes('mens-college-basketball/scoreboard?dates=20270408')));
  assert.ok(capturedUrls.some(url => url.includes('womens-college-basketball/scoreboard?dates=20270315')));
  assert.ok(capturedUrls.some(url => url.includes('womens-college-basketball/scoreboard?dates=20270408')));
  assert.equal(capturedUrls.some(url => /dates=\d{8}-\d{8}/.test(url)), false);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs.map(spec => spec.source), ['espn-ncaamb', 'espn-ncaawb']);
  assert.deepEqual(specs.map(spec => spec.sport), ['ncaab', 'ncaab']);
  assert.deepEqual(specs.map(spec => spec.league), ['ncaamb', 'ncaawb']);
  assert.equal(specs[0].question, '¿Quién gana Connecticut Huskies @ Kansas Jayhawks?');
  assert.deepEqual(specs[0].resolver_config, {
    source: 'espn',
    leaguePath: 'basketball/mens-college-basketball',
    eventId: 'm-1',
    dateYmd: kickoff.slice(0, 10),
    shape: 'binary',
  });
  assert.deepEqual(specs[1].resolver_config, {
    source: 'espn',
    leaguePath: 'basketball/womens-college-basketball',
    eventId: 'w-1',
    dateYmd: kickoff.slice(0, 10),
    shape: 'binary',
  });
});
