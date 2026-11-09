import test from 'node:test';
import assert from 'node:assert/strict';

import { generateSoccerMarkets, _internal } from './soccer.js';

function soccerMatch({
  id = 100,
  stage = 'FINAL',
  homeShortName = 'PSG',
  awayShortName = 'Arsenal',
} = {}) {
  return {
    id,
    utcDate: '2026-05-30T16:00:00.000Z',
    stage,
    matchday: 17,
    competition: { name: 'UEFA Champions League' },
    homeTeam: {
      id: 524,
      name: 'Paris Saint-Germain FC',
      shortName: homeShortName,
      tla: 'PSG',
      crest: 'psg.png',
    },
    awayTeam: {
      id: 57,
      name: 'Arsenal FC',
      shortName: awayShortName,
      tla: 'ARS',
      crest: 'arsenal.png',
    },
  };
}

test('UEFA Champions League final generates a binary winner market with no draw', () => {
  const spec = _internal.matchToMarketSpec(soccerMatch(), 'CL');

  assert.equal(spec.question, 'PSG vs Arsenal');
  assert.deepEqual(spec.outcomes, ['PSG', 'Arsenal']);
  assert.deepEqual(spec.outcome_images, ['psg.png', 'arsenal.png']);
  assert.equal(spec.amm_mode, 'unified');
  assert.equal(spec.resolver_config.shape, 'binary');
});

test('UEFA Champions League final also generates goals and MVP side markets', () => {
  const specs = _internal.matchToMarketSpecs(soccerMatch(), 'CL');

  assert.deepEqual(specs.map(spec => spec.source_event_id), [
    '100',
    '100:goals-over-2-5',
    '100:forward-mvp',
  ]);
  assert.deepEqual(specs.map(spec => spec.question), [
    'PSG vs Arsenal',
    '¿La final tendrá más de 2.5 goles?',
    '¿Un delantero gana el MVP de la final?',
  ]);
  assert.deepEqual(specs.map(spec => spec.outcomes), [
    ['PSG', 'Arsenal'],
    ['Sí', 'No'],
    ['Sí', 'No'],
  ]);
  assert.equal(specs[1].resolver_config.shape, 'total-goals-over');
  assert.equal(specs[1].resolver_config.threshold, 2.5);
  assert.equal(specs[2].resolver_type, null);
  assert.equal(specs[2].resolver_config, null);
});

test('non-final soccer matches keep the regular three-way draw market', () => {
  const spec = _internal.matchToMarketSpec(soccerMatch({ id: 101, stage: 'SEMI_FINALS' }), 'CL');

  assert.deepEqual(spec.outcomes, ['PSG', 'Empate', 'Arsenal']);
  assert.deepEqual(spec.outcome_images, ['psg.png', null, 'arsenal.png']);
  assert.equal(spec.resolver_config.shape, 'draw3');
  assert.equal(_internal.matchToMarketSpecs(soccerMatch({ id: 101, stage: 'SEMI_FINALS' }), 'CL').length, 1);
});

test('football-data soccer competitions import every fixture with canonical league slugs', () => {
  assert.deepEqual(_internal.COMPETITIONS_ALL_FIXTURES, ['CL', 'CLI', 'PD', 'PL', 'SA', 'BL1']);
  assert.deepEqual(_internal.COMPETITIONS_TEAM_FILTER, []);
  assert.ok(_internal.TEAM_MATCH_SUPPLEMENT_IDS.some(team => team.id === 5 && team.tla === 'BAY'));
  assert.ok(_internal.TEAM_MATCH_SUPPLEMENT_IDS.some(team => team.id === 4 && team.tla === 'BVB'));

  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'EL').league, 'uefa-europa-league');
  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'UCL').league, 'uefa-conference-league');
  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'CLI').league, 'copa-libertadores');
  assert.equal(_internal.matchToMarketSpec(soccerMatch(), 'BL1').league, 'bundesliga');
});

test('one-legged continental finals generate binary winner markets', () => {
  const europaFinal = _internal.matchToMarketSpec(soccerMatch(), 'EL');
  const conferenceFinal = _internal.matchToMarketSpec(soccerMatch(), 'UCL');
  const libertadoresFinal = _internal.matchToMarketSpec(soccerMatch(), 'CLI');

  assert.deepEqual(europaFinal.outcomes, ['PSG', 'Arsenal']);
  assert.deepEqual(conferenceFinal.outcomes, ['PSG', 'Arsenal']);
  assert.deepEqual(libertadoresFinal.outcomes, ['PSG', 'Arsenal']);
  assert.equal(europaFinal.resolver_config.shape, 'binary');
  assert.equal(conferenceFinal.resolver_config.shape, 'binary');
  assert.equal(libertadoresFinal.resolver_config.shape, 'binary');
});

test('UEFA final fallbacks fill Europa and Conference when upstream is empty', () => {
  const europa = _internal.fallbackFinalMatchesForCompetition('EL', '2026-05-20', '2026-05-21');
  const conference = _internal.fallbackFinalMatchesForCompetition('UCL', '2026-05-20', '2026-05-28');

  const europaSpec = _internal.matchToMarketSpec(europa[0], 'EL');
  const conferenceSpec = _internal.matchToMarketSpec(conference[0], 'UCL');

  assert.equal(europaSpec.question, 'Freiburg vs Aston Villa');
  assert.deepEqual(europaSpec.outcomes, ['Freiburg', 'Aston Villa']);
  assert.equal(europaSpec.source, 'uefa.com');
  assert.equal(europaSpec.resolver_type, 'sports_api');
  assert.deepEqual(europaSpec.resolver_config, {
    source: 'espn',
    leaguePath: 'soccer/uefa.europa',
    eventId: null,
    dateYmd: '2026-05-20',
    homeName: 'Freiburg',
    awayName: 'Aston Villa',
    shape: 'binary',
  });
  assert.equal(europaSpec.source_event_id, 'uefa-2026-europa-final');

  assert.equal(conferenceSpec.question, 'Crystal Palace vs Rayo Vallecano');
  assert.deepEqual(conferenceSpec.outcomes, ['Crystal Palace', 'Rayo Vallecano']);
  assert.equal(conferenceSpec.source, 'uefa.com');
  assert.equal(conferenceSpec.resolver_type, 'sports_api');
  assert.equal(conferenceSpec.resolver_config.leaguePath, 'soccer/uefa.europa.conf');
  assert.equal(conferenceSpec.resolver_config.shape, 'binary');
  assert.equal(conferenceSpec.source_event_id, 'uefa-2026-conference-final');
});

test('UEFA final fallbacks only apply inside the generation window', () => {
  assert.deepEqual(_internal.fallbackFinalMatchesForCompetition('EL', '2026-05-21', '2026-05-28'), []);
  assert.deepEqual(_internal.fallbackFinalMatchesForCompetition('UCL', '2026-05-20', '2026-05-26'), []);
  assert.deepEqual(_internal.fallbackFinalMatchesForCompetition('CL', '2026-05-20', '2026-05-28'), []);
});

test('team-calendar supplement imports standalone finals for whitelisted clubs', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FOOTBALL_DATA_API_KEY;
  const originalSupplement = process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
  process.env.FOOTBALL_DATA_API_KEY = 'test-football-data-key';
  process.env.POINTS_SOCCER_TEAM_SUPPLEMENT = '1';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = originalKey;
    if (originalSupplement == null) delete process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
    else process.env.POINTS_SOCCER_TEAM_SUPPLEMENT = originalSupplement;
  });

  const urls = [];
  const response = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  });
  const finalMatch = {
    id: 777001,
    utcDate: '2026-08-18T18:30:00.000Z',
    stage: 'FINAL',
    status: 'SCHEDULED',
    competition: { id: 2003, name: 'DFL-Supercup' },
    homeTeam: {
      id: 5,
      name: 'FC Bayern München',
      shortName: 'Bayern Munich',
      tla: 'BAY',
      crest: 'bayern.png',
    },
    awayTeam: {
      id: 4,
      name: 'Borussia Dortmund',
      shortName: 'Borussia Dortmund',
      tla: 'BVB',
      crest: 'dortmund.png',
    },
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    urls.push(text);
    if (text.includes('/teams/5/matches') || text.includes('/teams/4/matches')) {
      return response({ matches: [finalMatch] });
    }
    return response({ matches: [] });
  };

  const specs = await generateSoccerMarkets({ horizonDays: 14 });
  const matchSpec = specs.find(spec => spec.source_event_id === String(finalMatch.id));

  assert.ok(matchSpec);
  assert.match(urls.join('\n'), /\/teams\/5\/matches/);
  assert.equal(matchSpec.question, 'Bayern Munich vs Borussia Dortmund');
  assert.deepEqual(matchSpec.outcomes, ['Bayern Munich', 'Borussia Dortmund']);
  assert.equal(matchSpec.resolver_type, 'sports_api');
  assert.equal(matchSpec.resolver_config.source, 'football-data');
  assert.equal(matchSpec.resolver_config.shape, 'binary');
  assert.equal(matchSpec.source_data.knockoutFinal, true);
});

test('team-calendar supplement skips Spanish second-division fixtures', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FOOTBALL_DATA_API_KEY;
  const originalSupplement = process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
  process.env.FOOTBALL_DATA_API_KEY = 'test-football-data-key';
  process.env.POINTS_SOCCER_TEAM_SUPPLEMENT = '1';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = originalKey;
    if (originalSupplement == null) delete process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
    else process.env.POINTS_SOCCER_TEAM_SUPPLEMENT = originalSupplement;
  });

  const response = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  });
  const segundaMatch = {
    id: 887001,
    utcDate: '2026-09-12T18:30:00.000Z',
    stage: 'REGULAR_SEASON',
    status: 'SCHEDULED',
    competition: { code: 'SD', name: 'LaLiga Hypermotion' },
    homeTeam: {
      id: 87,
      name: 'Rayo Vallecano de Madrid',
      shortName: 'Rayo Vallecano',
      tla: 'RAY',
      crest: 'rayo.png',
    },
    awayTeam: {
      id: 745,
      name: 'Racing Club de Ferrol',
      shortName: 'Racing Ferrol',
      tla: 'FER',
      crest: 'ferrol.png',
    },
  };

  globalThis.fetch = async (url) => {
    const text = String(url);
    if (text.includes('/teams/87/matches')) return response({ matches: [segundaMatch] });
    return response({ matches: [] });
  };

  const specs = await generateSoccerMarkets({ horizonDays: 14 });

  assert.equal(_internal.shouldImportTeamSupplementMatch(segundaMatch), false);
  assert.equal(_internal.teamSupplementCompetitionCode(segundaMatch, { id: 87 }), 'SD');
  assert.equal(_internal.matchToMarketSpec(segundaMatch, 'PD'), null);
  assert.equal(specs.some(spec => spec.source_event_id === String(segundaMatch.id)), false);
});

test('team-calendar supplement is skipped by default', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FOOTBALL_DATA_API_KEY;
  const originalSupplement = process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
  process.env.FOOTBALL_DATA_API_KEY = 'test-football-data-key';
  delete process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey == null) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = originalKey;
    if (originalSupplement == null) delete process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
    else process.env.POINTS_SOCCER_TEAM_SUPPLEMENT = originalSupplement;
  });

  const urls = [];
  const response = (body) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  });

  globalThis.fetch = async (url) => {
    const text = String(url);
    urls.push(text);
    return response({ matches: [] });
  };

  const specs = await generateSoccerMarkets({ horizonDays: 14 });

  assert.deepEqual(specs, []);
  assert.ok(urls.length > 0);
  assert.ok(urls.every(url => !url.includes('/teams/')));
  assert.equal(_internal.soccerTeamSupplementEnabled(), false);
});

function setBulkTestEnvironment(t) {
  const originalKey = process.env.FOOTBALL_DATA_API_KEY;
  const originalSupplement = process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
  process.env.FOOTBALL_DATA_API_KEY = 'test-key';
  delete process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
  t.after(() => {
    if (originalKey === undefined) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = originalKey;
    if (originalSupplement === undefined) delete process.env.POINTS_SOCCER_TEAM_SUPPLEMENT;
    else process.env.POINTS_SOCCER_TEAM_SUPPLEMENT = originalSupplement;
  });
}

function bulkFixture(id, code, utcDate) {
  return {
    id, utcDate, status: 'SCHEDULED', competition: { code },
    homeTeam: { name: 'Home' }, awayTeam: { name: 'Away' },
  };
}

test('bulk fixture requests cover the final day and retain competition order and resolver data', async t => {
  setBulkTestEnvironment(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const request = new URL(url);
    requests.push(request);
    const { searchParams: params } = request;
    const kickoff = params.get('dateFrom') + 'T18:00:00Z';
    const finalDay = new Date(Date.parse(params.get('dateTo')) - 6 * 3600_000).toISOString();
    const matches = requests.length === 1
      ? [bulkFixture(3, 'PL', kickoff), bulkFixture(1, 'PL', kickoff)]
      : [bulkFixture(2, 'PD', finalDay)];
    return Response.json({
      filters: { competitions: params.get('competitions') },
      resultSet: { count: matches.length },
      matches,
    });
  });
  const specs = await generateSoccerMarkets({ bulk: true });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.pathname === '/v4/matches'));
  const day = (request, key) => Date.parse(request.searchParams.get(key)) / 86_400_000;
  const start = day(requests[0], 'dateFrom');
  assert.equal(day(requests[0], 'dateTo'), start + 10);
  assert.equal(day(requests[1], 'dateFrom'), start + 10);
  assert.equal(day(requests[1], 'dateTo'), start + 15);
  assert.deepEqual(specs.map(spec => [spec.league, spec.resolver_config.matchId]), [
    ['la-liga', 2], ['premier-league', 1], ['premier-league', 3],
  ]);
});

test('an incomplete bulk window falls back for every competition without retaining partial fixtures', async t => {
  setBulkTestEnvironment(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    const request = new URL(url);
    requests.push(request.pathname);
    const kickoff = request.searchParams.get('dateFrom') + 'T18:00:00Z';
    if (request.pathname === '/v4/matches') {
      return Response.json({
        filters: { competitions: request.searchParams.get('competitions') },
        resultSet: { count: 1 },
        matches: requests.length === 1 ? [bulkFixture(1, 'PL', kickoff)] : [],
      });
    }
    return Response.json({
      matches: request.pathname === '/v4/competitions/PL/matches' ? [bulkFixture(2, 'PL', kickoff)] : [],
    });
  });
  const specs = await generateSoccerMarkets({ bulk: true });
  assert.deepEqual(requests, [
    '/v4/matches', '/v4/matches',
    ..._internal.COMPETITIONS_ALL_FIXTURES.map(code => `/v4/competitions/${code}/matches`),
  ]);
  assert.deepEqual(specs.filter(spec => spec.league === 'premier-league').map(spec => spec.resolver_config.matchId), [2]);
});
