import test from 'node:test';
import assert from 'node:assert/strict';
import { readEspnEvent, readFootballDataMatch } from './sports-results.js';
import { resolveAutoResolverCandidate } from './auto-resolver-core.js';

// The actual Flamengo / Estudiantes feed separates the 0-0 match score
// from the 2-3 shootout, but flags Estudiantes as the overall winner.
function shootoutEvent() {
  return { id: '401912521', competitions: [{
    status: { type: { name: 'STATUS_FINAL_PEN', state: 'post', completed: true } },
    competitors: [
      { homeAway: 'home', score: '0', winner: false, shootoutScore: 2,
        linescores: [0, 0, 0, 0, 2].map(displayValue => ({ displayValue: String(displayValue) })),
        team: { displayName: 'Flamengo' } },
      { homeAway: 'away', score: '0', winner: true, shootoutScore: 3,
        linescores: [0, 0, 0, 0, 3].map(displayValue => ({ displayValue: String(displayValue) })),
        team: { displayName: 'Estudiantes de La Plata' } },
    ],
  }] };
}
const lookup = { leaguePath: 'soccer/conmebol.libertadores', eventId: '401912521',
  dateYmd: '2026-10-23', homeName: 'Flamengo', awayName: 'Estudiantes LP', shape: 'draw3' };

function mockFetch(t, body) {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => ({ ok: true, status: 200, json: async () =>
    String(url).includes('/summary?') ? { header: body } : { events: [body] } });
}

test('ESPN: scoreboard and exact summary both settle 0-0 as a draw despite the shootout winner', async t => {
  mockFetch(t, shootoutEvent());
  for (const preferSummary of [false, true]) {
    const r = await readEspnEvent({ ...lookup, preferSummary });
    assert.equal(r.completed, true);
    assert.equal(r.winner, 'draw');
    assert.deepEqual([r.homeScore, r.awayScore], [0, 0]);
  }
});

test('ESPN: winner-only final retains the shootout winner', async t => {
  mockFetch(t, shootoutEvent());
  const r = await readEspnEvent({ ...lookup, shape: 'binary', preferSummary: true });
  assert.equal(r.completed, true);
  assert.equal(r.winner, 'away');
});

test('ESPN: extra-time goals are excluded from 1X2 and total-goals markets', async t => {
  const ev = shootoutEvent();
  ev.competitions[0].status.type.name = 'STATUS_FINAL_AET';
  for (const [i, c] of ev.competitions[0].competitors.entries()) {
    delete c.shootoutScore;
    c.score = i === 0 ? '2' : '1';
    c.winner = i === 0;
    c.linescores = (i === 0 ? [0, 1, 1, 0] : [1, 0, 0, 0]).map(value => ({ value }));
  }
  mockFetch(t, ev);
  for (const shape of ['draw3', 'total-goals-over']) {
    const r = await readEspnEvent({ ...lookup, shape });
    assert.equal(r.winner, 'draw');
    assert.deepEqual([r.homeScore, r.awayScore], [1, 1]);
  }
  const r = await readEspnEvent({ ...lookup, shape: 'binary' });
  assert.equal(r.winner, 'home');
  assert.deepEqual([r.homeScore, r.awayScore], [2, 1]);
});

test('ESPN: aggregate advancement flag cannot override the actual 90-minute loser', async t => {
  const ev = shootoutEvent();
  ev.competitions[0].status.type.name = 'STATUS_FULL_TIME';
  for (const [i, c] of ev.competitions[0].competitors.entries()) {
    delete c.shootoutScore;
    delete c.linescores;
    c.score = i === 0 ? '1' : '2';
    c.winner = i === 0;
  }
  mockFetch(t, ev);
  const r = await readEspnEvent(lookup);
  assert.equal(r.completed, true);
  assert.equal(r.winner, 'away');
  assert.deepEqual([r.homeScore, r.awayScore], [1, 2]);
});

test('ESPN: missing 90-minute periods after extra time defers instead of inventing a score', async t => {
  const ev = shootoutEvent();
  ev.competitions[0].competitors.forEach(c => { delete c.linescores; });
  mockFetch(t, ev);
  const r = await readEspnEvent(lookup);
  assert.equal(r.completed, false);
  assert.equal(r.invalidResult, true);
});

test('ESPN: summary refresh and reversed team orientation preserve regulation-time semantics', async t => {
  const ev = shootoutEvent();
  mockFetch(t, ev);
  const r = await readEspnEvent({ ...lookup, eventId: null, preferSummary: true,
    homeName: 'Estudiantes de La Plata', awayName: 'Flamengo' });
  assert.equal(r.completed, true);
  assert.equal(r.winner, 'draw');
  assert.deepEqual([r.homeScore, r.awayScore], [0, 0]);
  assert.equal(r.eventOrientation, 'swapped');
});

function footballData(t, score) {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  process.env.FOOTBALL_DATA_API_KEY = 'test';
  t.after(() => {
    if (key == null) delete process.env.FOOTBALL_DATA_API_KEY;
    else process.env.FOOTBALL_DATA_API_KEY = key;
  });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    id: 576425, status: 'FINISHED', score,
    homeTeam: { name: 'Flamengo' }, awayTeam: { name: 'Estudiantes' },
  }) });
}

test('football-data: regulation score wins over fullTime and shootout winner', async t => {
  footballData(t, { winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT',
    fullTime: { home: 2, away: 3 }, regularTime: { home: 0, away: 0 },
    penalties: { home: 2, away: 3 } });
  const r = await readFootballDataMatch(576425, { shape: 'draw3' });
  assert.equal(r.completed, true);
  assert.equal(r.winner, 'draw');
  assert.deepEqual([r.homeScore, r.awayScore], [0, 0]);
  assert.equal((await readFootballDataMatch(576425, { shape: 'binary' })).winner, 'away');
});

test('football-data: extra-time result cannot override a regulation draw', async t => {
  footballData(t, { winner: 'HOME_TEAM', duration: 'EXTRA_TIME',
    fullTime: { home: 2, away: 1 }, regularTime: { home: 1, away: 1 } });
  for (const shape of ['draw3', 'total-goals-over']) {
    const r = await readFootballDataMatch(576425, { shape });
    assert.equal(r.winner, 'draw');
    assert.deepEqual([r.homeScore, r.awayScore], [1, 1]);
  }
});

test('football-data: missing regulation scores after penalties stay unresolved', async t => {
  footballData(t, { winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT',
    fullTime: { home: 2, away: 3 }, regularTime: { home: null, away: null } });
  const r = await readFootballDataMatch(576425, { shape: 'draw3' });
  assert.equal(r.completed, false);
  assert.equal(r.invalidResult, true);
});

test('football-data: ordinary full-time scores work, but null scores never become zero', async t => {
  footballData(t, { winner: 'DRAW', duration: 'REGULAR', fullTime: { home: null, away: null } });
  assert.equal((await readFootballDataMatch(576425, { shape: 'draw3' })).completed, false);
  footballData(t, { winner: 'AWAY_TEAM', duration: 'REGULAR', fullTime: { home: 0, away: 1 } });
  assert.equal((await readFootballDataMatch(576425, { shape: 'draw3' })).winner, 'away');
});

test('shared resolver: football-data maps a penalty match to the draw option and 90-minute banner', async t => {
  footballData(t, { winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT',
    fullTime: { home: 2, away: 3 }, regularTime: { home: 0, away: 0 } });
  const r = await resolveAutoResolverCandidate({ resolver_type: 'sports_api',
    resolver_config: { source: 'football-data', matchId: 576425, shape: 'draw3' },
    outcomes: ['Flamengo', 'Empate', 'Estudiantes'] });
  assert.equal(r.winningIdx, 1);
  assert.equal(r.finalScore, 'Flamengo 0-0 Estudiantes');
});

test('shared resolver: football-data fallback preserves draw rules through ESPN', async t => {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  delete process.env.FOOTBALL_DATA_API_KEY;
  t.after(() => { if (key != null) process.env.FOOTBALL_DATA_API_KEY = key; });
  mockFetch(t, shootoutEvent());
  const r = await resolveAutoResolverCandidate({ resolver_type: 'sports_api',
    resolver_config: { source: 'football-data', matchId: 576425, shape: 'draw3', espnFallback: lookup },
    outcomes: ['Flamengo', 'Empate', 'Estudiantes LP'] });
  assert.equal(r.winningIdx, 1);
  assert.equal(r.finalScore, 'Flamengo 0-0 Estudiantes de La Plata');
});

test('ESPN: extra-time status without period scores cannot fall back to the final total', async t => {
  const ev = shootoutEvent();
  ev.competitions[0].status.type.name = 'STATUS_FINAL_AET';
  ev.competitions[0].competitors.forEach(c => { delete c.linescores; delete c.shootoutScore; });
  mockFetch(t, ev);
  const r = await readEspnEvent(lookup);
  assert.equal(r.completed, false);
  assert.equal(r.invalidResult, true);
});
