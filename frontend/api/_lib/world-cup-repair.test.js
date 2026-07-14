import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWorldCupGroupSpec,
  buildWorldCupKnockoutSpec,
  finalScoreForGroupFixture,
  finalScoreForKnockout,
  findGroupEventForFixture,
  groupFixtureWinnerIndex,
  knockoutWinnerIndex,
  normalizeWorldCupEspnEvent,
} from './world-cup-repair.js';
import { GROUP_FIXTURES } from './world-cup-2026.js';

function espnEvent({
  id = '760514',
  date = '2026-07-14T19:00:00Z',
  completed = false,
  homeAbbr = 'FRA',
  homeName = 'France',
  homeScore = '0',
  homeWinner = false,
  awayAbbr = 'ESP',
  awayName = 'Spain',
  awayScore = '0',
  awayWinner = false,
} = {}) {
  return {
    id,
    date,
    status: { type: { state: completed ? 'post' : 'pre', completed } },
    competitions: [{
      competitors: [
        {
          homeAway: 'home',
          score: homeScore,
          winner: homeWinner,
          team: { abbreviation: homeAbbr, shortDisplayName: homeName, displayName: `${homeName} National Team` },
        },
        {
          homeAway: 'away',
          score: awayScore,
          winner: awayWinner,
          team: { abbreviation: awayAbbr, shortDisplayName: awayName, displayName: `${awayName} National Team` },
        },
      ],
    }],
  };
}

test('World Cup ESPN knockout specs are binary and use Spanish team labels', () => {
  const event = normalizeWorldCupEspnEvent(espnEvent());
  const spec = buildWorldCupKnockoutSpec(event);

  assert.equal(event.round, 'sf');
  assert.equal(event.home.name, 'Francia');
  assert.equal(event.away.name, 'España');
  assert.deepEqual(spec.outcomes, ['Francia', 'España']);
  assert.equal(spec.outcomes.includes('Empate'), false);
  assert.equal(spec.resolver_config.shape, 'binary');
  assert.equal(spec.resolver_config.eventId, '760514');
  assert.equal(spec.source_event_id, 'wc26-espn-760514');
});

test('World Cup completed knockout events expose winner index and final score', () => {
  const event = normalizeWorldCupEspnEvent(espnEvent({
    id: '760510',
    date: '2026-07-09T19:00:00Z',
    completed: true,
    homeAbbr: 'FRA',
    homeName: 'France',
    homeScore: '2',
    homeWinner: true,
    awayAbbr: 'MAR',
    awayName: 'Morocco',
    awayScore: '0',
  }));

  assert.equal(event.round, 'qf');
  assert.equal(knockoutWinnerIndex(event), 0);
  assert.equal(finalScoreForKnockout(event), 'Francia 2-0 Marruecos');
});

test('World Cup group fixture matching patches ESPN event ids and draw results', () => {
  const fixture = GROUP_FIXTURES.find(f => f.matchId === 'wc26-A-MD1-1');
  const event = normalizeWorldCupEspnEvent(espnEvent({
    id: '760415',
    date: '2026-06-11T19:00:00Z',
    completed: true,
    homeAbbr: 'MEX',
    homeName: 'Mexico',
    homeScore: '1',
    awayAbbr: 'RSA',
    awayName: 'South Africa',
    awayScore: '1',
  }));

  assert.equal(findGroupEventForFixture(fixture, [event])?.eventId, '760415');
  const spec = buildWorldCupGroupSpec(fixture, event);
  assert.equal(spec.resolver_config.source, 'espn');
  assert.equal(spec.resolver_config.eventId, '760415');
  assert.equal(spec.resolver_config.shape, 'draw3');
  assert.equal(groupFixtureWinnerIndex(fixture, event), 1);
  assert.equal(finalScoreForGroupFixture(fixture, event), 'México 1-1 Sudáfrica');
});
