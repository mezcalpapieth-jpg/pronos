import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildSeriesDetail, normalizeSeriesMeta, seriesMetaForGame, seriesSubtitle, teamPairKeyFromMeta } from './series-markets.js';

for (const scope of ['points', 'protocol']) {
  const source = await readFile(new URL(`../${scope}/market.js`, import.meta.url), 'utf8');
  const query = source.match(/const pendingRows = await sqlClient`([\s\S]*?)`;/)?.[1];
  const summarizer = source.slice(source.indexOf('function summarizePendingSeriesRow('), source.indexOf('async function loadSeriesDetail('));

  test(`${scope} series API excludes rejected, expired and already-approved source listings`, async t => {
    const db = new PGlite();
    t.after(() => db.close());
    const approvedColumn = scope === 'points' ? 'approved_market_id' : 'approved_protocol_market_id';
    await db.exec(`
      CREATE TABLE ${scope}_pending_markets (
        id INT, ${approvedColumn} INT, question TEXT, outcomes JSONB,
        start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, status TEXT,
        resolver_type TEXT DEFAULT 'sports_api', resolver_config JSONB,
        sport TEXT, league TEXT, source_data JSONB
      );
    `);
    const config = { source: 'espn', leaguePath: 'baseball/mlb' };
    const anchor = new Date().toISOString();
    for (const [id, status, approved, hours] of [
      [1, 'pending', null, 24], [2, 'rejected', null, 24],
      [3, 'pending', null, -24], [4, 'approved', 99, 24],
    ]) {
      await db.query(`INSERT INTO ${scope}_pending_markets
        (id,status,${approvedColumn},start_time,end_time,resolver_config)
        VALUES ($1,$2,$3,$4::timestamptz + $5 * interval '1 hour',
          $4::timestamptz + $5 * interval '1 hour' + interval '4 hours',$6)`,
      [id,status,approved,anchor,hours,JSON.stringify(config)]);
    }
    const sqlClient = async (strings, ...values) => (await db.query(
      strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values,
    )).rows;
    const run = new Function('sqlClient', 'currentMeta', 'anchor', `return sqlClient\`${query}\`;`);
    assert.ok(query);
    const rows = await run(sqlClient, { leaguePath: 'baseball/mlb' }, anchor);
    assert.deepEqual(rows.map(row => row.pending_id), [1]);
  });

  test(`${scope} an elapsed pending event never becomes a fabricated resolved result`, () => {
    const summarize = new Function('parseJsonb', 'publicSeriesMetaFromRow', 'seriesMetaForGame',
      `${summarizer}; return summarizePendingSeriesRow;`)(
      value => value, () => null, seriesMetaForGame,
    );
    const row = summarize({
      id: 28955, status: 'pending', outcomes: ['Guardians', 'Rays'],
      start_time: '2026-01-01T00:00:00Z', end_time: '2026-01-01T04:00:00Z',
    }, {});
    assert.equal(row.status, 'pending');
    assert.equal(row.outcome, null);
    assert.equal(row.resolvedAt, null);
  });
}


test('the actual Points detail query keeps postponed/rejected listings out of Game 5 and locks Game 7', async t => {
  const source = await readFile(new URL('../points/market.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function publicSeriesMetaFromRow('), source.indexOf('export default async function handler('));
  const parseJsonb = (value, fallback) => value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value;
  const load = new Function('parseJsonb', 'normalizeSeriesMeta', 'seriesMetaForGame', 'seriesSubtitle', 'teamPairKeyFromMeta', 'buildSeriesDetail',
    `${functions}; return loadSeriesDetail;`)(parseJsonb, normalizeSeriesMeta, seriesMetaForGame, seriesSubtitle, teamPairKeyFromMeta, buildSeriesDetail);
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_markets (
      id INT PRIMARY KEY, question TEXT, outcomes JSONB, start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ, status TEXT, outcome INT, resolved_at TIMESTAMPTZ,
      final_score TEXT, resolver_config JSONB, sport TEXT, league TEXT,
      parent_id INT, resolver_type TEXT DEFAULT 'sports_api'
    );
    CREATE TABLE points_pending_markets (
      id INT, approved_market_id INT, question TEXT, outcomes JSONB,
      start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, status TEXT,
      resolver_type TEXT DEFAULT 'sports_api', resolver_config JSONB,
      sport TEXT, league TEXT, source_data JSONB
    );
  `);
  const cle = { id: '5', name: 'Cleveland Guardians', shortName: 'Guardians' };
  const tb = { id: '30', name: 'Tampa Bay Rays', shortName: 'Rays' };
  const meta = { key: 'baseball-mlb:2026:series:30-5', leaguePath: 'baseball/mlb',
    bestOf: 7, gameNumber: 5, homeTeam: cle, awayTeam: tb, teams: [cle, tb] };
  const outcomes = JSON.stringify([cle.name, tb.name]);
  const anchor = new Date(Date.now() - 86400000).toISOString();
  for (let game = 1; game <= 7; game++) {
    const config = JSON.stringify({ source: 'espn', leaguePath: 'baseball/mlb', series: { ...meta, gameNumber: game } });
    const status = game <= 5 ? 'approved' : 'pending';
    if (game <= 5) await db.query(`INSERT INTO points_markets
      (id,outcomes,start_time,end_time,status,outcome,resolver_config)
      VALUES ($1,$2,$3::timestamptz + $4 * interval '1 day',
        $3::timestamptz + $4 * interval '1 day' + interval '4 hours','resolved',$5,$6)`,
    [game,outcomes,anchor,game - 5,[0,1,0,1,1][game - 1],config]);
    await db.query(`INSERT INTO points_pending_markets
      (id,approved_market_id,outcomes,start_time,end_time,status,resolver_config)
      VALUES ($1,$2,$3,$4::timestamptz + $5 * interval '1 day',
        $4::timestamptz + $5 * interval '1 day' + interval '4 hours',$6,$7)`,
    [game,game <= 5 ? game : null,outcomes,anchor,game - 5,status,config]);
  }
  // Rejected source event for the postponed Game 4; it has no result.
  await db.query(`INSERT INTO points_pending_markets
    (id,outcomes,start_time,end_time,status,resolver_config)
    SELECT 28955,outcomes,start_time,end_time,'rejected',resolver_config FROM points_pending_markets WHERE id=4`);
  // A repeated approval join must not add another Game 1 win.
  await db.query(`INSERT INTO points_pending_markets SELECT 99,approved_market_id,question,outcomes,start_time,end_time,status,resolver_type,resolver_config,sport,league,source_data FROM points_pending_markets WHERE id=1`);
  const sqlClient = async (strings, ...values) => (await db.query(
    strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values,
  )).rows;
  // Another series between the same pair falls inside the 45-day lookup.
  const earlierAnchor = new Date(new Date(anchor).getTime() - 20 * 86400000).toISOString();
  for (let game = 1; game <= 2; game++) {
    const config = JSON.stringify({ source: 'espn', leaguePath: 'baseball/mlb', series: { ...meta, gameNumber: game } });
    await db.query(`INSERT INTO points_markets
      (id,outcomes,start_time,end_time,status,outcome,resolver_config)
      VALUES ($1,$2,$3::timestamptz + $4 * interval '1 day',
        $3::timestamptz + $4 * interval '1 day' + interval '4 hours','resolved',$5,$6)`,
    [90+game,outcomes,earlierAnchor,game-1,game-1,config]);
  }
  const earlier = await load(sqlClient, { id: 91, start_time: earlierAnchor }, { ...meta, gameNumber: 1 });
  assert.equal(earlier.summary, 'Guardians lidera 1-0');
  assert.deepEqual(earlier.sequence.filter(game => game.id != null).map(game => game.id), [91,92]);
  const detail = await load(sqlClient, { id: 5, start_time: anchor }, meta);
  assert.equal(detail.subtitle, 'Juego 5 · Rays lidera 3-2');
  assert.deepEqual(detail.sequence.slice(0,5).map(game => game.id), [1,2,3,4,5]);
  assert.equal(detail.sequence[6].seriesLocked, true);
  assert.equal(detail.sequence[6].outcome, null);
  assert.equal(detail.sequence[6].finalScore, null);
});
