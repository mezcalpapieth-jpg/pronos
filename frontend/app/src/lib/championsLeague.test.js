import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHAMPIONS_LEAGUE_FINAL,
  CHAMPIONS_LEAGUE_MARKET_GROUPS,
  CHAMPIONS_LEAGUE_NEXT_SEASON,
  CHAMPIONS_LEAGUE_ROAD,
  formatCountdown,
} from './championsLeague.js';

test('Champions League hub models the PSG vs Arsenal final countdown', () => {
  assert.equal(CHAMPIONS_LEAGUE_FINAL.home.shortName, 'PSG');
  assert.equal(CHAMPIONS_LEAGUE_FINAL.away.shortName, 'ARS');
  assert.equal(CHAMPIONS_LEAGUE_FINAL.kickoffIso, '2026-05-30T16:00:00.000Z');
  assert.match(CHAMPIONS_LEAGUE_FINAL.venue, /Budapest/);

  assert.deepEqual(
    formatCountdown('2026-05-30T16:00:00.000Z', '2026-05-29T14:28:03.000Z'),
    { days: 1, hours: 1, minutes: 31, seconds: 57, done: false },
  );
});

test('Champions League road keeps current markets closed and future season hidden', () => {
  assert.ok(CHAMPIONS_LEAGUE_ROAD.some(round => round.id === 'final'));
  assert.ok(CHAMPIONS_LEAGUE_ROAD.every(round => round.status === 'closed'));
  assert.ok(CHAMPIONS_LEAGUE_MARKET_GROUPS.flatMap(group => group.markets).every(m => m.status === 'closed'));
  assert.equal(CHAMPIONS_LEAGUE_NEXT_SEASON.enabled, false);
});
