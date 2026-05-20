import test from 'node:test';
import assert from 'node:assert/strict';

import { readEspnEvent } from './sports-results.js';

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
