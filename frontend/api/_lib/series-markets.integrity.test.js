import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSeriesDetail, extractEspnSeriesMeta } from './series-markets.js';

const cle = { id: '5', name: 'Cleveland Guardians', shortName: 'Guardians' };
const tb = { id: '30', name: 'Tampa Bay Rays', shortName: 'Rays' };
const meta = {
  key: 'baseball-mlb:2026:series:30-5', leaguePath: 'baseball/mlb',
  bestOf: 7, gameNumber: 5, homeTeam: cle, awayTeam: tb, teams: [cle, tb],
};
function games() {
  return [cle, tb, cle, tb, tb].map((winner, i) => ({
    id: [343778, 349646, 352449, 358258, 364118][i],
    status: 'resolved', outcome: winner === cle ? 0 : 1,
    outcomes: [cle.name, tb.name],
    startTime: `2026-10-${String(12 + i).padStart(2, '0')}T21:00:00Z`,
    seriesMeta: { ...meta, gameNumber: i + 1 },
  }));
}

test('Game 5 remains Rays 3-2 with the rejected, postponed Game 4 listing', () => {
  const rows = games();
  rows.push({
    id: null, pendingId: 28955, status: 'resolved', outcome: null,
    outcomes: [cle.name, tb.name], seriesMeta: { ...meta, gameNumber: 4 },
  });
  const detail = buildSeriesDetail(meta, rows);
  assert.equal(detail.summary, 'Rays lidera 3-2');
  assert.equal(detail.teamAWins + detail.teamBWins, 5);
  assert.equal(detail.sequence[3].id, 358258);
});

test('duplicate published rows and pending replacements count one result per game', () => {
  const rows = games();
  const detail = buildSeriesDetail(meta, [
    ...rows, ...rows.map(row => ({ ...row })),
    { ...rows[3], id: null, pendingId: 12, outcome: null, status: 'pending' },
  ]);
  assert.equal(detail.summary, 'Rays lidera 3-2');
  assert.equal(detail.sequence[3].id, 358258);
});

for (const outcome of [null, undefined, '', ' ', false, true, -1, 2, 0.5]) {
  test(`a missing or invalid winner (${JSON.stringify(outcome)}) never becomes a home win`, () => {
    const row = { ...games()[0], outcome };
    const detail = buildSeriesDetail({ ...meta, gameNumber: 1 }, [row]);
    assert.equal(detail.teamAWins, null);
    assert.equal(detail.teamBWins, null);
  });
}

test('unpublished and rejected rows cannot supply results or official series scores', () => {
  const rows = games();
  const detail = buildSeriesDetail(meta, [
    ...rows,
    { ...rows[0], id: null, pendingId: 13, outcome: 0, status: 'resolved' },
    { ...rows[4], id: null, pendingId: 14, status: 'rejected',
      seriesMeta: { ...meta, espnSeriesWins: { homeWins: 4, awayWins: 1 } } },
  ]);
  assert.equal(detail.summary, 'Rays lidera 3-2');
});

test('best-of-five ignores extra games and a provider score where both teams clinched', () => {
  const five = { ...meta, bestOf: 5, espnSeriesWins: { homeWins: 3, awayWins: 3 } };
  const rows = games().map(row => ({ ...row, seriesMeta: { ...row.seriesMeta, bestOf: 5 } }));
  const detail = buildSeriesDetail(five, [
    ...rows, { ...rows[0], id: 6, seriesMeta: { ...five, gameNumber: 6 } },
  ]);
  assert.equal(detail.summary, 'Rays lidera 3-2');
  assert.equal(detail.sequence.length, 5);
});

test('results after the clinching game cannot add more series wins', () => {
  const five = { ...meta, bestOf: 5 };
  const rows = games().map((row, i) => ({
    ...row, outcome: i < 3 ? 0 : 1, seriesMeta: { ...five, gameNumber: i + 1 },
  }));
  const detail = buildSeriesDetail(five, rows);
  assert.equal(detail.summary, 'Guardians lidera 3-0');
});

test('a resolved Game 3 stays at its own result after Games 4 and 5 finish', () => {
  const detail = buildSeriesDetail({ ...meta, gameNumber: 3 }, games());
  assert.equal(detail.summary, 'Guardians lidera 2-1');
});


test('a duplicated market with missing game metadata cannot become an extra game', () => {
  const rows = games().map(row => ({ ...row, seriesMeta: { ...meta, gameNumber: null } }));
  const detail = buildSeriesDetail(meta, [...rows, { ...rows[0] }]);
  assert.equal(detail.summary, 'Rays lidera 3-2');
  assert.equal(detail.sequence.filter(game => game.id != null).length, 5);
});

test('a contradictory provider snapshot cannot overwrite the published game results', () => {
  const detail = buildSeriesDetail({ ...meta, espnSeriesWins: { homeWins: 4, awayWins: 1 } }, games());
  assert.equal(detail.summary, 'Rays lidera 3-2');
});


test('a stored pregame score combines with later settlements without losing or duplicating wins', () => {
  const third = { ...meta, gameNumber: 3, espnSeriesWins: { homeWins: 2, awayWins: 0 } };
  const detail = buildSeriesDetail(third, [
    { ...games()[2], outcome: 1, seriesMeta: third },
  ]);
  assert.equal(detail.summary, 'Guardians lidera 2-1');
  assert.equal(detail.scoreComplete, true);
});

test('incomplete history has no confirmed score instead of a misleading partial lead', () => {
  const third = { ...meta, gameNumber: 3, espnSeriesWins: { homeWins: 0, awayWins: 0 } };
  const detail = buildSeriesDetail(third, [{ ...games()[2], seriesMeta: third }]);
  assert.equal(detail.scoreComplete, false);
  assert.equal(detail.teamAWins, null);
  assert.equal(detail.teamBWins, null);
  assert.equal(detail.summary, null);
  assert.equal(detail.subtitle, 'Juego 3');
});

test('separate series between the same teams keep their own results and sequences', () => {
  const old = games().slice(0,2).map((row,i) => ({
    ...row, id: 100 + i, startTime: `2026-09-${22+i}T21:00:00Z`,
    outcome: i === 0 ? 0 : 1,
  }));
  const recent = games().slice(0,3).map(row => ({ ...row, outcome: 1 }));
  const rows = [...old, ...recent];
  for (const [current, expected, ids] of [
    [old[0], 'Guardians lidera 1-0', [100,101]],
    [old[1], 'Serie empatada 1-1', [100,101]],
    [recent[0], 'Rays lidera 1-0', recent.map(row => row.id)],
    [recent[2], 'Rays lidera 3-0', recent.map(row => row.id)],
  ]) {
    const detail = buildSeriesDetail(current.seriesMeta, rows, { currentMarketId: current.id });
    assert.equal(detail.summary, expected);
    assert.deepEqual(detail.sequence.filter(game => game.id != null).map(game => game.id), ids);
    assert.equal(detail.scoreComplete, true);
  }
});

test('an unpublished listing cannot supply an official score for missing results', () => {
  const third = { ...meta, gameNumber: 3 };
  const detail = buildSeriesDetail(third, [
    { ...games()[2], seriesMeta: third },
    { id: null, pendingId: 123, status: 'pending', seriesMeta: {
      ...meta, gameNumber: 4, espnSeriesWins: { homeWins: 2, awayWins: 1 },
    } },
  ]);
  assert.equal(detail.scoreComplete, false);
  assert.equal(detail.summary, null);
});


test('a provider snapshot with an unknown team score never invents zero wins', () => {
  for (const awayWins of [undefined, null, '', false, 1.5, -1]) {
    const extracted = extractEspnSeriesMeta({
      date: '2026-10-15T21:00:00Z', season: { year: 2026, type: 3 },
      competitions: [{
        competitors: [{ homeAway: 'home', team: cle }, { homeAway: 'away', team: tb }],
        series: { gameNumber: 4, totalCompetitions: 7, competitors: [
          { team: cle, wins: 2 }, { team: tb, wins: awayWins },
        ] },
      }],
    }, { leaguePath: 'baseball/mlb' });
    assert.equal(extracted.espnSeriesWins, null);
  }
});
