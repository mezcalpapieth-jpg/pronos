import test from 'node:test';
import assert from 'node:assert/strict';

import { generateEspnSoccerMarkets, _internal } from './espn-soccer.js';

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

test('UEFA Europa and Conference ESPN events become tournament draw markets', () => {
  const europa = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'uefa-europa-league');
  const conference = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'uefa-conference-league');
  const europaSpec = _internal.eventToSpec(espnEvent({
    id: '401915586',
    homeName: 'AC Milan',
    awayName: 'Benfica',
  }), europa);
  const conferenceSpec = _internal.eventToSpec(espnEvent({
    id: '401921111',
    homeName: 'Crystal Palace',
    awayName: 'Rayo Vallecano',
  }), conference);

  assert.equal(europaSpec.league, 'uefa-europa-league');
  assert.equal(europaSpec.resolver_config.leaguePath, 'soccer/uefa.europa');
  assert.equal(europaSpec.source_event_id, 'uefa.europa:401915586');
  assert.equal(europaSpec.source_data.leagueLabel, 'UEFA Europa League (UEL)');
  assert.equal(europaSpec.source_data.matchTypeLabel, 'TORNEO');
  assert.deepEqual(europaSpec.outcomes, ['AC Milan', 'Empate', 'Benfica']);

  assert.equal(conferenceSpec.league, 'uefa-conference-league');
  assert.equal(conferenceSpec.resolver_config.leaguePath, 'soccer/uefa.europa.conf');
  assert.equal(conferenceSpec.source_event_id, 'uefa.europa.conf:401921111');
  assert.equal(conferenceSpec.source_data.leagueLabel, 'UEFA Conference League (UECL)');
  assert.equal(conferenceSpec.source_data.matchTypeLabel, 'TORNEO');
  assert.deepEqual(conferenceSpec.outcomes, ['Crystal Palace', 'Empate', 'Rayo Vallecano']);
});

test('international tournament ESPN feeds become auto-resolving tournament markets', () => {
  const cases = [
    ['uefa.nations', 'uefa-nations-league', 'soccer/uefa.nations', 'uefa.nations:401999001', 'UEFA Nations League'],
    ['uefa.euro', 'eurocopa', 'soccer/uefa.euro', 'uefa.euro:401999002', 'Eurocopa'],
    ['fifa.worldq.conmebol', 'conmebol', 'soccer/fifa.worldq.conmebol', 'fifa.worldq.conmebol:401999003', 'Eliminatorias CONMEBOL'],
    ['conmebol.sudamericana', 'conmebol', 'soccer/conmebol.sudamericana', 'conmebol.sudamericana:401999004', 'CONMEBOL Sudamericana'],
    ['conmebol.america', 'conmebol', 'soccer/conmebol.america', 'conmebol.america:401999005', 'Copa América'],
    ['concacaf.nations.league', 'concacaf', 'soccer/concacaf.nations.league', 'concacaf.nations.league:401999006', 'CONCACAF Nations League'],
    ['concacaf.gold', 'concacaf', 'soccer/concacaf.gold', 'concacaf.gold:401999007', 'CONCACAF Gold Cup'],
    ['concacaf.champions', 'concacaf', 'soccer/concacaf.champions', 'concacaf.champions:401999008', 'CONCACAF Champions Cup'],
  ];

  for (const [leagueCode, league, leaguePath, sourceEventId, leagueLabel] of cases) {
    const config = _internal.ESPN_SOCCER_LEAGUES.find(c => c.leagueCode === leagueCode);
    const spec = _internal.eventToSpec(espnEvent({
      id: sourceEventId.split(':').at(-1),
      homeName: 'Mexico',
      awayName: 'Canada',
    }), config);

    assert.equal(spec.league, league);
    assert.equal(spec.resolver_config.leaguePath, leaguePath);
    assert.equal(spec.resolver_config.shape, 'draw3');
    assert.equal(spec.source_event_id, sourceEventId);
    assert.equal(spec.source_data.leagueLabel, leagueLabel);
    assert.equal(spec.source_data.matchTypeLabel, 'TORNEO');
    assert.deepEqual(spec.outcomes, ['Mexico', 'Empate', 'Canada']);
  }
});

test('club friendly feed is limited to the summer break while MLS stays year-round', () => {
  const mls = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'mls');
  const clubFriendly = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'club-friendlies');

  assert.equal(mls.whitelist, undefined);
  assert.equal(clubFriendly.whitelist, undefined);
  assert.equal(_internal.shouldFetchLeagueEvents(mls, new Date('2026-09-08T12:00:00Z')), true);
  assert.equal(_internal.shouldFetchLeagueEvents(clubFriendly, new Date('2026-09-08T12:00:00Z')), false);
  assert.equal(_internal.shouldFetchLeagueEvents(clubFriendly, new Date('2026-07-10T12:00:00Z')), true);
});

test('generator does not fetch club friendlies outside the summer break', async () => {
  const requestedLeagueCodes = [];
  await generateEspnSoccerMarkets({
    now: new Date('2026-09-08T12:00:00Z'),
    fetchLeagueEventsFn: async (leagueCode) => {
      requestedLeagueCodes.push(leagueCode);
      return [];
    },
  });

  assert.ok(requestedLeagueCodes.includes('mex.1'));
  assert.ok(requestedLeagueCodes.includes('usa.1'));
  assert.ok(requestedLeagueCodes.includes('concacaf.leagues.cup'));
  assert.ok(requestedLeagueCodes.includes('uefa.europa'));
  assert.ok(requestedLeagueCodes.includes('uefa.europa.conf'));
  assert.ok(requestedLeagueCodes.includes('uefa.nations'));
  assert.ok(requestedLeagueCodes.includes('uefa.euro'));
  assert.ok(requestedLeagueCodes.includes('fifa.worldq.conmebol'));
  assert.ok(requestedLeagueCodes.includes('conmebol.sudamericana'));
  assert.ok(requestedLeagueCodes.includes('conmebol.america'));
  assert.ok(requestedLeagueCodes.includes('concacaf.nations.league'));
  assert.ok(requestedLeagueCodes.includes('concacaf.gold'));
  assert.ok(requestedLeagueCodes.includes('concacaf.champions'));
  assert.ok(requestedLeagueCodes.includes('fifa.friendly'));
  assert.equal(requestedLeagueCodes.includes('club.friendly'), false);
});

test('Conference League uses a longer fixture lookahead than the default soccer window', async () => {
  const ranges = new Map();
  await generateEspnSoccerMarkets({
    now: new Date('2026-09-08T12:00:00Z'),
    fetchLeagueEventsFn: async (leagueCode, dateRange) => {
      ranges.set(leagueCode, dateRange);
      return [];
    },
  });

  assert.equal(ranges.get('mex.1'), '20260908-20260922');
  assert.equal(ranges.get('uefa.europa'), '20260908-20260922');
  assert.equal(ranges.get('uefa.europa.conf'), '20260908-20261023');
  assert.equal(
    _internal.dateRangeForConfig(
      _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'uefa-conference-league'),
      new Date('2026-09-08T12:00:00Z'),
    ),
    '20260908-20261023',
  );
});

test('ESPN soccer fetches daily scoreboards instead of one broad range', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    const requestedUrl = String(url);
    requestedUrls.push(requestedUrl);
    return {
      ok: true,
      json: async () => ({
        events: requestedUrl.includes('dates=20260918')
          ? [espnEvent({ id: '401915586', homeName: 'Roma', awayName: 'Celta Vigo' })]
          : [],
      }),
    };
  };

  try {
    const events = await _internal.fetchLeagueEvents('uefa.europa', '20260917-20260918');
    assert.deepEqual(events.map(event => event.id), ['401915586']);
    assert.deepEqual(
      requestedUrls.map(url => url.match(/dates=([^&]+)/)?.[1]),
      ['20260917', '20260918'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ESPN soccer events with placeholder team names are skipped', () => {
  const config = _internal.ESPN_SOCCER_LEAGUES.find(c => c.league === 'club-friendlies');

  assert.equal(
    _internal.eventToSpec(espnEvent({ homeName: 'TBD Home', awayName: 'Ksour Essef' }), config),
    null,
  );
  assert.equal(
    _internal.eventToSpec(espnEvent({ homeName: 'AS FAR', awayName: 'To Be Determined' }), config),
    null,
  );
});

test('legacy club friendly whitelist remains available for manual inspection', () => {
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
