import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateBoxingMarkets,
  _internal,
} from './boxing.js';

function boxingEvent({ id, home, away, commenceTime }) {
  return {
    id,
    home_team: home,
    away_team: away,
    commence_time: commenceTime,
    sport_title: 'Boxing',
  };
}

test('boxing import filter requires a Mexican boxer or both fighters to be marquee', () => {
  assert.equal(_internal.shouldGenerateFor('Canelo Alvarez', 'Unknown Opponent'), true);
  assert.equal(_internal.shouldGenerateFor('Tyson Fury', 'Fabio Wardley'), false);
  assert.equal(_internal.shouldGenerateFor('Tyson Fury', 'Oleksandr Usyk'), true);
});

test('boxing date filter rejects Jan 1 placeholders and fights outside two weeks', () => {
  const now = new Date('2026-05-15T12:00:00.000Z');
  assert.equal(_internal.shouldKeepFightDate('2026-05-25T03:00:00.000Z', now), true);
  assert.equal(_internal.shouldKeepFightDate('2026-06-01T03:00:00.000Z', now), false);
  assert.equal(_internal.shouldKeepFightDate('2027-01-01T03:57:00.000Z', now), false);
});

test('boxing generator skips far-future placeholder rows from the odds feed', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.ODDS_API_KEY;
  process.env.ODDS_API_KEY = 'test-key';
  const now = Date.now();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ([
      boxingEvent({
        id: 'mexican-near',
        home: 'Canelo Alvarez',
        away: 'Unknown Opponent',
        commenceTime: new Date(now + 5 * 86_400_000).toISOString(),
      }),
      boxingEvent({
        id: 'single-marquee-near',
        home: 'Tyson Fury',
        away: 'Fabio Wardley',
        commenceTime: new Date(now + 5 * 86_400_000).toISOString(),
      }),
      boxingEvent({
        id: 'placeholder',
        home: 'Oleksandr Usyk',
        away: 'Tyson Fury',
        commenceTime: '2027-01-01T03:57:00.000Z',
      }),
    ]),
  });

  try {
    const specs = await generateBoxingMarkets();
    assert.deepEqual(specs.map(s => s.source_event_id), ['boxing:mexican-near']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.ODDS_API_KEY;
    else process.env.ODDS_API_KEY = originalKey;
  }
});

test('boxing h2h odds are converted into outcome-aligned suggested probabilities', () => {
  const consensus = _internal.extractH2hProbabilities({
    id: 'fight-1',
    bookmakers: [
      {
        title: 'Book A',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Canelo Alvarez', price: 1.5 },
            { name: 'Jaime Munguia', price: 2.7 },
          ],
        }],
      },
      {
        title: 'Book B',
        markets: [{
          key: 'h2h',
          outcomes: [
            { name: 'Canelo Álvarez', price: 1.4 },
            { name: 'Jaime Munguía', price: 3 },
          ],
        }],
      },
    ],
  }, ['Canelo Álvarez', 'Jaime Munguía']);

  assert.equal(consensus.bookmakerCount, 2);
  assert.equal(consensus.evidence[0].bookmaker, 'Book A');
  assert.ok(consensus.probabilityPct[0] > 60);
  assert.ok(consensus.probabilityPct[1] < 40);
});
