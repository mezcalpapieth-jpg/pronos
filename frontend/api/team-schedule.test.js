import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './team-schedule.js';

test('team schedule resolves ESPN soccer team ids and logos from league directory', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /\/soccer\/mex\.1\/teams$/);
    return {
      ok: true,
      json: async () => ({
        sports: [{
          leagues: [{
            teams: [{
              team: {
                id: '218',
                displayName: 'Cruz Azul',
                shortDisplayName: 'Cruz Azul',
                logos: [{ href: 'cruz.png' }],
              },
            }],
          }],
        }],
      }),
    };
  };

  try {
    const profile = await _internal.resolveEspnTeamProfile({
      slug: 'cruz-azul',
      name: 'Cruz Azul',
      sport: 'soccer',
      league: 'Liga MX',
      aliases: ['Cruz Azul FC'],
      espnLeaguePath: 'soccer/mex.1',
    });

    assert.equal(profile.espnTeamId, '218');
    assert.equal(profile.logoUrl, 'cruz.png');
  } finally {
    global.fetch = originalFetch;
  }
});

test('team schedule normalizes ESPN event logos and object scores', () => {
  const row = _internal.normalizeEspnEvent({
    id: '401',
    date: '2026-05-21T02:00:00.000Z',
    status: { type: { state: 'post', shortDetail: 'FT' } },
    competitions: [{
      venue: { fullName: 'Estadio Olimpico Universitario' },
      competitors: [
        {
          homeAway: 'home',
          team: { displayName: 'Cruz Azul', logos: [{ href: 'cruz.png' }] },
          score: { value: 2 },
        },
        {
          homeAway: 'away',
          team: { displayName: 'Pumas UNAM', logos: [{ href: 'pumas.png' }] },
          score: { displayValue: '1' },
        },
      ],
    }],
  }, { sport: 'soccer', league: 'Liga MX' });

  assert.equal(row.homeName, 'Cruz Azul');
  assert.equal(row.awayName, 'Pumas UNAM');
  assert.equal(row.homeLogo, 'cruz.png');
  assert.equal(row.awayLogo, 'pumas.png');
  assert.equal(row.homeScore, 2);
  assert.equal(row.awayScore, 1);
  assert.equal(row.finalScore, '2-1');
});
