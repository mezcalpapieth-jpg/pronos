import test from 'node:test';
import assert from 'node:assert/strict';

import { _internal } from './espn-soccer.js';

function espnEvent({
  id = '401863600',
  homeName = 'Seattle Sounders FC',
  awayName = 'Querétaro',
  homeLogo = 'https://example.com/sea.png',
  awayLogo = 'https://example.com/qro.png',
} = {}) {
  return {
    id,
    date: '2026-08-09T19:30:00Z',
    status: { type: { state: 'pre' } },
    competitions: [{
      venue: { fullName: 'Lumen Field' },
      competitors: [
        {
          homeAway: 'home',
          team: {
            id: '9726',
            displayName: homeName,
            abbreviation: 'SEA',
            logo: homeLogo,
          },
        },
        {
          homeAway: 'away',
          team: {
            id: '21311',
            displayName: awayName,
            abbreviation: 'QRO',
            logo: awayLogo,
          },
        },
      ],
    }],
  };
}

test('Leagues Cup ESPN events become binary tournament markets', () => {
  const config = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'leagues-cup');
  const spec = _internal.eventToSpec(espnEvent(), config);

  assert.equal(spec.league, 'leagues-cup');
  assert.equal(spec.question, 'Seattle Sounders FC vs Querétaro');
  assert.deepEqual(spec.outcomes, ['Seattle Sounders FC', 'Querétaro']);
  assert.deepEqual(spec.outcome_images, ['https://example.com/sea.png', 'https://example.com/qro.png']);
  assert.equal(spec.resolver_config.leaguePath, 'soccer/concacaf.leagues.cup');
  assert.equal(spec.resolver_config.shape, 'binary');
  assert.equal(spec.source_data.matchTypeLabel, 'TORNEO');
  assert.equal(
    new Date(spec.end_time).getTime() - new Date(spec.start_time).getTime(),
    4 * 3600_000,
  );
});

test('international friendlies remain three-way and carry an international label', () => {
  const config = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'international');
  const spec = _internal.eventToSpec(espnEvent({
    homeName: 'Mexico',
    awayName: 'Argentina',
  }), config);

  assert.equal(spec.league, 'international');
  assert.deepEqual(spec.outcomes, ['Mexico', 'Empate', 'Argentina']);
  assert.deepEqual(spec.outcome_images, ['https://example.com/sea.png', null, 'https://example.com/qro.png']);
  assert.equal(spec.resolver_config.leaguePath, 'soccer/fifa.friendly');
  assert.equal(spec.resolver_config.shape, 'draw3');
  assert.equal(spec.source_data.matchTypeLabel, 'INTERNACIONAL');
});

test('club friendlies import only tracked teams', () => {
  assert.equal(
    _internal.eventMatchesWhitelist(
      espnEvent({ homeName: 'Manchester City', awayName: 'Atlético Madrid' }),
      _internal.CLUB_FRIENDLY_WHITELIST,
    ),
    true,
  );
  assert.equal(
    _internal.eventMatchesWhitelist(
      espnEvent({ homeName: 'Radomiak Radom', awayName: 'AEL' }),
      _internal.CLUB_FRIENDLY_WHITELIST,
    ),
    false,
  );
});
