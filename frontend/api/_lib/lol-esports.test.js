import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fetchLolSchedule, normalizeLolEvent, parseLolSchedule, readLolEvent } from './lol-esports.js';
import { generateLolEsportsMarkets } from './market-gen/lol-esports.js';
import { prepareGeneratedSpecs, GENERATORS, runAllGenerators } from './run-generators.js';
import { resolveAutoResolverCandidate } from './auto-resolver-core.js';
import { sportsTradeLock } from './points-sports-trade-guard.js';
import { buildEspnLiveScoreConfig } from './espn-live-score.js';
import liveScoreHandler from '../sports/live-score.js';
import { cardLiveScoreUrl, compactCardScore } from '../../app/points/src/lib/cardLiveScore.js';

// Official LoL Esports Apollo event data captured November 10, 2026.
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/lol-worlds-2026.json', import.meta.url)));
const [final, semifinal] = fixtures;
const now = new Date('2026-11-10T18:00:00Z');
function configFor(event) {
  return { source: 'lolesports', shape: 'binary', eventId: event.id, leagueSlug: 'worlds',
    tournamentId: event.tournament.id, homeId: event.matchTeams[0].teamId, awayId: event.matchTeams[1].teamId,
    bestOf: event.match.strategy.count };
}
function scheduleHtml(events) {
  return `<script>(window[Symbol.for("ApolloSSRDataTransport")] ??= []).push({"rehydrate":{"data":undefined},"data":{"__typename":"EsportsData","events":${JSON.stringify(events)}}})</script>`;
}
function fetchSchedule(events) {
  return async url => {
    assert.equal(String(url), 'https://lolesports.com/en-US/leagues/worlds');
    return new Response(scheduleHtml(events));
  };
}

test('Riot schedule parsing preserves long IDs and handles reordered Apollo duplicates', () => {
  // Use a genuine deep copy with a different top-level property order.
  const duplicate = Object.fromEntries(Object.entries(final).reverse());
  assert.deepEqual(parseLolSchedule(scheduleHtml([final, duplicate, semifinal])), [final, semifinal]);
  assert.equal(parseLolSchedule(scheduleHtml([final]))[0].id, '115660540726095133');
  assert.deepEqual(parseLolSchedule(scheduleHtml([])), []);
});

test('blocked, partial, missing and conflicting official data fail visibly', async () => {
  for (const html of ['<h1>Worlds</h1>', scheduleHtml([final]).slice(0, -100), '<script>"events":[]</script>']) {
    assert.throws(() => parseLolSchedule(html));
  }
  const changed = structuredClone(final);
  changed.state = 'completed';
  assert.throws(() => parseLolSchedule(scheduleHtml([final, changed])), /conflicting/);
  await assert.rejects(fetchLolSchedule({ fetchImpl: async () => new Response('Blocked', { status: 403 }) }), /HTTP 403/);
  const { sourceStats } = await runAllGenerators({ generators: [{ name: 'lol-esports', run: () => generateLolEsportsMarkets({ now, fetchImpl: async () => new Response('unavailable', { status: 503 }) }) }] });
  assert.match(sourceStats['lol-esports'].error, /HTTP 503/);
});

test('generator creates only confirmed future series, with criteria, source, team logos and English', async () => {
  assert.ok(GENERATORS.some(generator => generator.name === 'lol-esports'));
  const tbd = structuredClone(final);
  tbd.id = tbd.match.id = '123456789012345678';
  tbd.matchTeams[0].name = 'TBD';
  const specs = await prepareGeneratedSpecs(await generateLolEsportsMarkets({ now, fetchImpl: fetchSchedule([...fixtures, tbd]) }));
  assert.equal(specs.length, 1);
  const spec = specs[0];
  assert.equal(spec.sport, 'esports');
  assert.equal(spec.league, 'lol');
  assert.equal(spec.source_event_id, final.id);
  assert.deepEqual(spec.outcomes, final.matchTeams.map(team => team.name));
  assert.equal(spec.seed_liquidities[0], spec.seed_liquidities[1]);
  assert.equal(spec.start_time, '2026-11-14T19:00:00.000Z');
  assert.equal(spec.end_time, '2026-11-15T02:00:00.000Z');
  assert.equal(spec.resolver_config.tournamentId, final.tournament.id);
  assert.match(spec.resolver_config.criteria, /serie completa/);
  assert.ok(spec.outcome_images.every(url => url.startsWith('https:')));
  assert.equal(spec.source_data.translations.en.question, 'Who wins Gen.G Esports vs BILIBILI GAMING?');
  assert.deepEqual(await generateLolEsportsMarkets({ now: '2026-11-14T19:00:00Z', fetchImpl: fetchSchedule([final]) }), []);
});

test('official semifinal settles by the pinned team IDs even when provider team order reverses', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const reversed = structuredClone(semifinal);
  reversed.matchTeams.reverse();
  globalThis.fetch = fetchSchedule([reversed]);
  const config = configFor(semifinal);
  const decision = await resolveAutoResolverCandidate({ resolver_type: 'sports_api', resolver_config: config,
    outcomes: semifinal.matchTeams.map(team => team.name) });
  assert.equal(decision.winningIdx, 0);
  assert.equal(decision.finalScore, 'Gen.G Esports 3-0 Invictus Gaming');
  assert.equal(decision.resolverInfo.eventId, semifinal.id);
  assert.equal(decision.resolverInfo.sourceUrl, 'https://lolesports.com/en-US/leagues/worlds');
  assert.ok(decision.resolverInfo.observedAt);
  const awayDecision = await resolveAutoResolverCandidate({ resolver_type: 'sports_api',
    resolver_config: { ...config, homeId: config.awayId, awayId: config.homeId },
    outcomes: [...semifinal.matchTeams.map(team => team.name)].reverse() });
  assert.equal(awayDecision.winningIdx, 1);
  assert.equal(awayDecision.finalScore, 'Invictus Gaming 0-3 Gen.G Esports');
});

test('a final must agree on match, tournament, participants, series length, scores and winner', () => {
  const config = configFor(semifinal);
  for (const patch of [
    event => { event.id = '999'; },
    event => { event.tournament.id = '999'; },
    event => { event.matchTeams[0].teamId = '999'; },
    event => { event.match.strategy.count = 3; },
    event => { event.matchTeams[1].result.gameWins = 3; },
    event => { event.matchTeams[0].result.gameWins = null; },
    event => { event.matchTeams[0].result.gameWins = 2; },
    event => { event.matchTeams[0].result.outcome = 'loss'; },
    event => { event.matchTeams[1].result.outcome = 'win'; },
    event => { event.match.state = 'inProgress'; },
    event => { event.match.type = 'forfeit'; },
  ]) {
    const event = structuredClone(semifinal);
    patch(event);
    const result = normalizeLolEvent(event, config);
    assert.equal(result.completed, false);
    assert.equal(result.winner, null);
    assert.equal(result.invalidResult, true);
  }
});

test('unstarted, live and interrupted series stay unresolved, and missing events never match by team name', async () => {
  const config = configFor(final);
  assert.equal(normalizeLolEvent(final, config).state, 'pre');
  for (const state of ['inProgress', 'canceled', 'postponed']) {
    const event = structuredClone(final);
    event.state = event.match.state = state;
    event.matchTeams[0].result.gameWins = 2;
    event.matchTeams[1].result.gameWins = 2;
    const result = normalizeLolEvent(event, config);
    assert.equal(result.completed, false);
    assert.equal(result.winner, null);
  }
  const invalidPreview = structuredClone(final);
  invalidPreview.matchTeams[0].result.gameWins = 1;
  assert.equal(normalizeLolEvent(invalidPreview, config).invalidResult, true);
  const missing = await readLolEvent({ ...config, eventId: '999' }, { fetchImpl: fetchSchedule([final]) });
  assert.equal(missing.notFound, true);
});

test('buy and sell guard blocks finals, clinched series, interrupted games and invalid source data', async () => {
  const config = configFor(final);
  const market = { resolver_config: config };
  assert.equal(await sportsTradeLock(market, { readLol: async cfg => normalizeLolEvent(final, cfg) }), null);
  for (const state of ['completed', 'inProgress', 'canceled']) {
    const event = structuredClone(final);
    event.state = event.match.state = state;
    event.matchTeams[0].result = { gameWins: 3, outcome: state === 'completed' ? 'win' : null };
    event.matchTeams[1].result = { gameWins: 1, outcome: state === 'completed' ? 'loss' : null };
    const lock = await sportsTradeLock(market, { readLol: async cfg => normalizeLolEvent(event, cfg) });
    assert.equal(lock.error, 'market_closed');
  }
  assert.equal((await sportsTradeLock(market, { readLol: async () => ({ state: 'in', invalidResult: true }) })).status, 503);
  assert.equal((await sportsTradeLock(market, { readLol: async () => { throw new Error('offline'); } })).status, 503);
});

test('live-score public endpoint and card use the pinned official series and expose no resolver criteria', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const event = structuredClone(final);
  event.state = event.match.state = 'inProgress';
  event.matchTeams[0].result.gameWins = 2;
  event.matchTeams[1].result.gameWins = 1;
  globalThis.fetch = fetchSchedule([event]);
  const config = buildEspnLiveScoreConfig({ resolverType: 'sports_api', resolverConfig: { ...configFor(final), criteria: 'private admin note' } });
  assert.equal(config.criteria, undefined);
  const query = Object.fromEntries(new URL(cardLiveScoreUrl(config), 'https://test.invalid').searchParams);
  const response = { setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
  await liveScoreHandler({ method: 'GET', headers: {}, query }, response);
  assert.equal(response.statusCode, 200);
  const score = response.body.liveScore;
  const display = compactCardScore({ status: 'active', sport: 'esports', liveScoreConfig: config,
    outcomes: final.matchTeams.map(team => team.name), startTime: '2026-11-10T17:00:00Z', endTime: '2026-11-10T23:00:00Z' },
  { ...score, lastUpdatedAt: now.toISOString() }, now.getTime());
  assert.equal(display.left.score, 2);
  assert.equal(display.right.score, 1);
  assert.equal(display.status, 'Bo5');
  await liveScoreHandler({ method: 'GET', headers: {}, query: { ...query, leagueSlug: '../../elsewhere' } }, response);
  assert.equal(response.statusCode, 400);
});
