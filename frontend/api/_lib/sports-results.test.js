import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readEspnAtpMatchWinner,
  readEspnAtpTournamentWinner,
  readEspnEvent,
  readEspnPgaWinner,
} from './sports-results.js';

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

const finalSummary = {
  header: {
    id: '401871326',
    competitions: [
      {
        status: { type: { state: 'post', completed: true } },
        competitors: [
          {
            homeAway: 'home',
            score: '108',
            winner: true,
            team: { displayName: 'Oklahoma City Thunder', shortDisplayName: 'Thunder' },
          },
          {
            homeAway: 'away',
            score: '90',
            winner: false,
            team: { displayName: 'Los Angeles Lakers', shortDisplayName: 'Lakers' },
          },
        ],
      },
    ],
  },
};

test('readEspnEvent falls back to per-event summary when date-window scoreboard misses a playoff rematch', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/scoreboard')) return jsonResponse({ events: [] });
    if (String(url).includes('/summary?event=401871326')) return jsonResponse(finalSummary);
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnEvent({
      leaguePath: 'basketball/nba',
      eventId: '401871326',
      dateYmd: '2026-05-13',
    });

    assert.equal(result.completed, true);
    assert.equal(result.winner, 'home');
    assert.equal(result.homeScore, 108);
    assert.equal(result.awayScore, 90);
    assert.equal(result.homeTeam, 'Thunder');
    assert.equal(result.awayTeam, 'Lakers');
    assert.equal(urls.length, 2);
    assert.match(urls[0], /scoreboard/);
    assert.match(urls[1], /summary\?event=401871326/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readEspnEvent can resolve soccer finals by team names when no ESPN event id is stored', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/scoreboard')) {
      return jsonResponse({
        events: [{
          id: '401862911',
          competitions: [{
            status: { type: { state: 'post', completed: true } },
            competitors: [
              {
                homeAway: 'home',
                score: '3',
                winner: true,
                team: { displayName: 'Aston Villa FC', shortDisplayName: 'Aston Villa' },
              },
              {
                homeAway: 'away',
                score: '0',
                winner: false,
                team: { displayName: 'SC Freiburg', shortDisplayName: 'Freiburg' },
              },
            ],
          }],
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnEvent({
      leaguePath: 'soccer/uefa.europa',
      eventId: null,
      dateYmd: '2026-05-20',
      homeName: 'Freiburg',
      awayName: 'Aston Villa',
    });

    assert.equal(result.completed, true);
    assert.equal(result.winner, 'away');
    assert.equal(result.homeScore, 0);
    assert.equal(result.awayScore, 3);
    assert.equal(result.homeTeam, 'Freiburg');
    assert.equal(result.awayTeam, 'Aston Villa');
    assert.equal(urls.length, 1);
    assert.match(urls[0], /soccer\/uefa\.europa\/scoreboard/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readEspnEvent matches display names when ESPN short names are abbreviated', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/scoreboard')) {
      return jsonResponse({
        events: [{
          id: '401865536',
          competitions: [{
            status: { type: { state: 'post', completed: true } },
            competitors: [
              {
                homeAway: 'home',
                score: '2',
                winner: false,
                team: { displayName: 'Cusco FC', shortDisplayName: 'Cusco' },
              },
              {
                homeAway: 'away',
                score: '3',
                winner: true,
                team: { displayName: 'Independiente Medellín', shortDisplayName: 'Ind. Medellín' },
              },
            ],
          }],
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnEvent({
      leaguePath: 'soccer/conmebol.libertadores',
      eventId: null,
      dateYmd: '2026-05-21',
      homeName: 'Cusco',
      awayName: 'Independiente',
    });

    assert.equal(result.completed, true);
    assert.equal(result.winner, 'away');
    assert.equal(result.homeScore, 2);
    assert.equal(result.awayScore, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readEspnAtpTournamentWinner exposes eliminated losers before the tournament is complete', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/tennis/atp/scoreboard')) {
      return jsonResponse({
        events: [{
          id: 'atp-1',
          status: { type: { state: 'in', completed: false } },
          groupings: [{
            grouping: { slug: 'mens-singles', name: "Men's Singles" },
            competitions: [{
              id: 'match-1',
              status: { type: { state: 'post', completed: true, description: 'Final' } },
              competitors: [
                { id: '1', winner: true, athlete: { id: '1', displayName: 'Carlos Alcaraz' } },
                { id: '2', winner: false, athlete: { id: '2', displayName: 'Taylor Fritz' } },
              ],
            }, {
              id: 'match-3',
              status: { type: { state: 'pre', completed: false } },
              competitors: [
                { id: '1', athlete: { id: '1', displayName: 'Carlos Alcaraz' } },
                { id: '3', athlete: { id: '3', displayName: 'Ben Shelton' } },
              ],
            }],
          }],
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnAtpTournamentWinner({ eventId: 'atp-1' });
    assert.equal(result.completed, false);
    assert.deepEqual(result.eliminatedCompetitors.map(row => ({
      driverId: row.driverId,
      label: row.label,
      reason: row.reason,
    })), [{
      driverId: '2',
      label: 'Taylor Fritz',
      reason: 'lost',
    }]);
    assert.deepEqual(result.remainingCompetitors.map(row => row.label), [
      'Carlos Alcaraz',
      'Ben Shelton',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readEspnAtpTournamentWinner keeps remaining competitors to unfinished ATP matches', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/tennis/atp/scoreboard')) {
      return jsonResponse({
        events: [{
          id: 'atp-2',
          status: { type: { state: 'in', completed: false } },
          groupings: [{
            grouping: { slug: 'mens-singles', name: "Men's Singles" },
            competitions: [{
              id: 'round-2',
              round: { id: '2', displayName: 'Round 2' },
              status: { type: { state: 'post', completed: true, description: 'Final' } },
              competitors: [
                { id: '1', winner: true, athlete: { id: '1', displayName: 'Taylor Fritz' } },
                { id: '2', winner: false, athlete: { id: '2', displayName: 'Flavio Cobolli' } },
              ],
            }, {
              id: 'quarterfinal',
              round: { id: '5', displayName: 'Quarterfinal' },
              status: { type: { state: 'post', completed: true, description: 'Final' } },
              competitors: [
                { id: '3', winner: true, athlete: { id: '3', displayName: 'Ben Shelton' } },
                { id: '1', winner: false, athlete: { id: '1', displayName: 'Taylor Fritz' } },
              ],
            }, {
              id: 'semifinal-a',
              round: { id: '6', displayName: 'Semifinal' },
              status: { type: { state: 'pre', completed: false, description: 'Scheduled' } },
              competitors: [
                { id: '3', athlete: { id: '3', displayName: 'Ben Shelton' } },
                { id: '4', athlete: { id: '4', displayName: 'Learner Tien' } },
              ],
            }, {
              id: 'semifinal-b',
              round: { id: '6', displayName: 'Semifinal' },
              status: { type: { state: 'pre', completed: false, description: 'Scheduled' } },
              competitors: [
                { id: '5', athlete: { id: '5', displayName: 'Brandon Nakashima' } },
                { id: '6', athlete: { id: '6', displayName: 'Rafael Jodar' } },
              ],
            }],
          }],
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnAtpTournamentWinner({ eventId: 'atp-2' });
    assert.equal(result.completed, false);
    assert.deepEqual(result.remainingCompetitors.map(row => row.label), [
      'Ben Shelton',
      'Learner Tien',
      'Brandon Nakashima',
      'Rafael Jodar',
    ]);
    assert.deepEqual(result.eliminatedCompetitors.map(row => row.label), [
      'Flavio Cobolli',
      'Taylor Fritz',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readEspnAtpMatchWinner resolves a completed match inside the tournament grouping', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/tennis/atp/scoreboard')) {
      return jsonResponse({
        events: [{
          id: 'atp-1',
          status: { type: { state: 'in', completed: false } },
          groupings: [{
            grouping: { slug: 'mens-singles', name: "Men's Singles" },
            competitions: [{
              id: 'match-2',
              status: { type: { state: 'post', completed: true } },
              competitors: [
                { id: '1', winner: false, athlete: { id: '1', displayName: 'Carlos Alcaraz' } },
                { id: '2', winner: true, athlete: { id: '2', displayName: 'Taylor Fritz' } },
              ],
            }],
          }],
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnAtpMatchWinner({ eventId: 'atp-1', matchId: 'match-2' });
    assert.equal(result.completed, true);
    assert.equal(result.winner, 'away');
    assert.equal(result.homeTeam, 'Carlos Alcaraz');
    assert.equal(result.awayTeam, 'Taylor Fritz');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('readEspnPgaWinner exposes only clearly eliminated golfers before completion', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/golf/pga/scoreboard')) {
      return jsonResponse({
        events: [{
          id: 'pga-1',
          status: { type: { state: 'in', completed: false } },
          competitions: [{
            competitors: [
              {
                id: '9478',
                type: 'athlete',
                athlete: { id: '9478', displayName: 'Scottie Scheffler' },
                status: { type: { description: 'Active' } },
              },
              {
                id: '3470',
                type: 'athlete',
                athlete: { id: '3470', displayName: 'Rory McIlroy' },
                status: { type: { description: 'CUT' } },
              },
            ],
          }],
        }],
      });
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await readEspnPgaWinner({ eventId: 'pga-1' });
    assert.equal(result.completed, false);
    assert.deepEqual(result.eliminatedCompetitors.map(row => ({
      driverId: row.driverId,
      label: row.label,
      reason: row.reason,
    })), [{
      driverId: '3470',
      label: 'Rory McIlroy',
      reason: 'cut',
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
