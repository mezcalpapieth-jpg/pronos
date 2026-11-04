import test from 'node:test';
import assert from 'node:assert/strict';
import { cardLiveScoreUrl, cardScoreWindowOpen, compactCardScore, loadCardLiveScore } from './cardLiveScore.js';

const now = Date.parse('2026-11-04T21:30:00Z');
const market = {
  status: 'active', sport: 'soccer', outcomes: ['Fenerbahçe', 'Empate', 'Liverpool'],
  startTime: '2026-11-04T20:00:00Z', endTime: '2026-11-04T23:00:00Z',
  liveScoreConfig: { source: 'espn', leaguePath: 'soccer/uefa.champions', eventId: 'game-1' },
};
const live = {
  eventId: 'game-1', sport: 'soccer', state: 'in', completed: false, statusLabel: "90'+1'",
  lastUpdatedAt: new Date(now).toISOString(),
  home: { name: 'Fenerbahce', score: 3 }, away: { name: 'Liverpool', score: 2 },
};

test('compact score follows card outcome order, including accents and known team aliases', () => {
  const score = compactCardScore(market, live, now);
  assert.deepEqual([score.left.abbreviation, score.left.score, score.right.score, score.right.abbreviation], ['FEN', 3, 2, 'LIV']);
  assert.equal(score.status, "90'+1'");
  const reversed = compactCardScore({ ...market, outcomes: ['Liverpool FC', 'Empate', 'Fenerbahçe'] }, live, now);
  assert.equal(reversed.left.name, 'Liverpool');
  assert.equal(reversed.left.score, 2);
  assert.equal(reversed.right.score, 3);
});

test('binary score labels retain explicit away/home identities and accept a genuine zero score', () => {
  const score = compactCardScore({ ...market, outcomes: ['Sí', 'No'] }, {
    ...live, home: { ...live.home, score: 0 }, away: { ...live.away, score: 0 },
  }, now);
  assert.deepEqual([score.left.abbreviation, score.left.score, score.right.score, score.right.abbreviation], ['LIV', 0, 0, 'FEN']);
});

test('Slavia Praha card keeps home-first score ordering when ESPN calls it Slavia Prague', () => {
  const score = compactCardScore({ ...market, outcomes: ['Slavia Praha', 'Empate', 'Arsenal'] }, {
    ...live, home: { name: 'Slavia Prague', score: 0 }, away: { name: 'Arsenal', score: 2 },
  }, now);
  assert.equal(score.left.name, 'Slavia Prague');
  assert.equal(score.left.score, 0);
  assert.equal(score.right.name, 'Arsenal');
  assert.equal(score.right.score, 2);
});

test('missing or invalid scores never become a fabricated zero', () => {
  for (const value of [null, undefined, '', '3', NaN, Infinity, -1]) {
    assert.equal(compactCardScore(market, { ...live, home: { ...live.home, score: value } }, now), null);
  }
  assert.equal(compactCardScore(market, { ...live, away: { name: '', score: 2 } }, now), null);
});

test('pregame, postponed, wrong-game and stale feed responses do not show a score', () => {
  for (const update of [
    { state: 'pre' }, { state: 'post', completed: false }, { eventId: 'other-game' },
    { lastUpdatedAt: new Date(now - 90_001).toISOString() },
    { lastUpdatedAt: new Date(now + 60_001).toISOString() }, { lastUpdatedAt: null },
  ]) assert.equal(compactCardScore(market, { ...live, ...update }, now), null);
});

test('verified final displays Final while the active market awaits settlement', () => {
  const score = compactCardScore(market, { ...live, state: 'post', completed: true }, now);
  assert.equal(score.status, 'Final');
  assert.equal(score.completed, true);
  assert.equal(market.status, 'active');
});

test('score requests are restricted to an active, started individual game window', () => {
  assert.equal(cardScoreWindowOpen(market, now), true);
  for (const update of [
    { status: 'resolved' }, { status: 'canceled' }, { liveScoreConfig: null }, { seriesLocked: true },
    { startTime: new Date(now + 1).toISOString() }, { startTime: null }, { endTime: null },
    { endTime: market.startTime }, { endTime: '2026-12-04T23:00:00Z' },
  ]) {
    assert.equal(cardScoreWindowOpen({ ...market, ...update }, now), false);
    assert.equal(compactCardScore({ ...market, ...update }, live, now), null);
  }
  assert.equal(cardScoreWindowOpen(market, Date.parse(market.endTime) + 6 * 3600_000 + 1), false);
});

test('card requests preserve event identity and the existing detail endpoint contract', () => {
  const url = new URL(cardLiveScoreUrl(market.liveScoreConfig), 'https://fixture.invalid');
  assert.equal(url.pathname, '/api/sports/live-score');
  assert.equal(url.searchParams.get('eventId'), 'game-1');
  assert.equal(url.searchParams.get('leaguePath'), 'soccer/uefa.champions');
  const fallback = new URL(cardLiveScoreUrl({ source: 'espn', leaguePath: 'soccer/eng.1', dateYmd: '20261104', homeName: 'Liverpool', awayName: 'Arsenal' }), url);
  assert.equal(fallback.searchParams.get('dateYmd'), '20261104');
  assert.equal(fallback.searchParams.get('homeName'), 'Liverpool');
  assert.equal(fallback.searchParams.get('awayName'), 'Arsenal');
  assert.equal(cardLiveScoreUrl({ leaguePath: 'soccer/eng.1', homeName: 'Liverpool' }), null);
  assert.equal(cardLiveScoreUrl(null), null);
});

test('duplicate cards share one in-flight request and reuse its recent result', async () => {
  let calls = 0, finish;
  const fetchImpl = async () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = loadCardLiveScore('/fixture/shared-event', { fetchImpl });
  const second = loadCardLiveScore('/fixture/shared-event', { fetchImpl });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => ({ liveScore: live }) });
  assert.equal(await first, live);
  assert.equal(await loadCardLiveScore('/fixture/shared-event', { fetchImpl }), live);
  assert.equal(calls, 1);
});

test('failed or empty refresh clears an earlier score instead of retaining stale data', async () => {
  const url = '/fixture/failed-event';
  await loadCardLiveScore(url, { fetchImpl: async () => ({ ok: true, json: async () => ({ liveScore: live }) }) });
  assert.equal(await loadCardLiveScore(url, {
    now: Date.now() + 21_000, fetchImpl: async () => ({ ok: false }),
  }), null);
  assert.equal(await loadCardLiveScore(url, { fetchImpl: () => { throw new Error('must remain cached'); } }), null);
  assert.equal(await loadCardLiveScore('/fixture/empty-event', { fetchImpl: async () => ({ ok: true, json: async () => ({ liveScore: null }) }) }), null);
  assert.equal(await loadCardLiveScore('/fixture/network-error', { fetchImpl: async () => { throw new Error('network unavailable'); } }), null);
});
