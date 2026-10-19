import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { runOfficialSnapshots, authorizedOfficialSnapshotRequest } from './points-official-snapshots.js';
import { automaticConfig, RT_OUTCOMES, RT_THRESHOLD_KIND, RT_THRESHOLD_FILMS } from '../_lib/automated-market-rules.js';
import { readCutoffResult } from '../_lib/official-cutoff-snapshots.js';
import { cancelPointsMarket } from '../_lib/points-cancel-market.js';

const ddlSource = await readFile(new URL('../_lib/points-schema.js', import.meta.url), 'utf8');
const ddl = ddlSource.match(/`(CREATE TABLE IF NOT EXISTS points_official_result_snapshots[\s\S]*?)`/)[1];
const cutoff = '2026-10-19T14:00:00Z';
const cfg = automaticConfig('rotten-tomatoes-cutoff', { cutoff });
const clock = () => new Date('2026-10-19T13:59:05Z');
const payload = { state: 'scored', score: 51, startedAt: clock().toISOString(), capturedAt: '2026-10-19T13:59:08Z' };
async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE points_markets (id INTEGER PRIMARY KEY, parent_id INTEGER, status TEXT DEFAULT 'active',
    resolver_type TEXT DEFAULT 'api_chart', resolver_config JSONB, outcomes JSONB, outcome INTEGER,
    resolved_at TIMESTAMPTZ, resolved_by TEXT);
    CREATE TABLE points_positions (market_id INTEGER, username TEXT, outcome_index INTEGER, shares NUMERIC, cost_basis NUMERIC, updated_at TIMESTAMPTZ);
    CREATE TABLE points_balances (username TEXT PRIMARY KEY, balance NUMERIC, updated_at TIMESTAMPTZ);
    CREATE TABLE points_distributions (username TEXT, amount NUMERIC, kind TEXT, reference_id INTEGER, reason TEXT);
    CREATE TABLE points_limit_orders (id INTEGER, market_id INTEGER, status TEXT);
    ${ddl};`);
  await db.query(`INSERT INTO points_markets (id, resolver_config, outcomes) VALUES (1,$1::jsonb,$2::jsonb)`, [JSON.stringify(cfg), JSON.stringify(RT_OUTCOMES)]);
  return db;
}
test('minutely collector persists real deadline evidence and resolver can replay it after close', async () => {
  const db = await database();
  try {
    let fetched = 0;
    const deps = { sql: db, clock, ensureSchema: async () => {}, collect: async () => { fetched++; return { payload, archive: [] }; } };
    const dry = await runOfficialSnapshots({ dryRun: true }, { ...deps, ensureSchema: () => assert.fail('dry-run DDL') });
    assert.deepEqual(dry.candidates, [1]); assert.equal(fetched, 0);
    assert.deepEqual((await runOfficialSnapshots({}, deps)).written, [1]);
    assert.deepEqual((await runOfficialSnapshots({}, deps)).written, []);
    const result = await readCutoffResult(cfg, RT_OUTCOMES, { sql: db, marketId: 1, now: new Date('2026-10-20') });
    assert.equal(result.winningIdx, 2);
    assert.equal((await db.query('SELECT COUNT(*) FROM points_official_result_snapshots')).rows[0].count, 1);
  } finally { await db.close(); }
});

test('collectors refuse late captures and races with admin contract edits', async () => {
  const db = await database();
  try {
    const deps = { sql: db, clock, ensureSchema: async () => {}, collect: async () => ({ payload: { ...payload, capturedAt: '2026-10-19T14:00:01Z' }, archive: [] }) };
    assert.deepEqual((await runOfficialSnapshots({}, deps)).written, []);
    deps.collect = async () => {
      await db.query(`UPDATE points_markets SET resolver_config = resolver_config || '{"edited":true}'::jsonb WHERE id=1`);
      return { payload, archive: [] };
    };
    assert.deepEqual((await runOfficialSnapshots({}, deps)).written, []);
    await assert.rejects(readCutoffResult(cfg, RT_OUTCOMES, { sql: db, marketId: 1, now: new Date('2026-10-20') }), /missing/);
    assert.equal((await runOfficialSnapshots({}, { ...deps, clock: () => new Date('2026-10-19T14:01:00Z') })).candidates.length, 0);
  } finally { await db.close(); }
});

test('automatic cancellation uses the admin refund procedure exactly once and guards contract changes', async () => {
  const db = await database();
  try {
    await db.exec(`INSERT INTO points_positions VALUES (1,'alice',0,300,100,NOW()),(1,'bob',1,200,75,NOW());
      INSERT INTO points_balances VALUES ('alice',500,NOW()),('bob',400,NOW());`);
    await assert.rejects(db.transaction(tx => cancelPointsMarket(tx, 1, { expectedConfig: { wrong: true } })), /contract_changed/);
    assert.equal((await db.query('SELECT balance FROM points_balances WHERE username=$1', ['alice'])).rows[0].balance, '500');
    const r = await db.transaction(tx => cancelPointsMarket(tx, 1, { actor: 'resolver:official-result', reason: 'No score', expectedConfig: cfg }));
    assert.equal(r.totalRefunded, 175);
    assert.equal((await db.query('SELECT balance FROM points_balances WHERE username=$1', ['alice'])).rows[0].balance, '600');
    assert.equal((await db.query('SELECT status, outcome FROM points_markets')).rows[0].status, 'canceled');
    assert.equal((await db.query('SELECT SUM(shares) AS shares FROM points_positions')).rows[0].shares, '0');
    await assert.rejects(db.transaction(tx => cancelPointsMarket(tx, 1, { actor: 'retry' })), /not_active/);
    assert.equal((await db.query('SELECT COUNT(*) FROM points_distributions')).rows[0].count, 2);
  } finally { await db.close(); }
});

test('cron requires its bearer secret in production and is actually scheduled every minute', async () => {
  const oldSecret = process.env.CRON_SECRET; const oldEnv = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = 'production'; delete process.env.CRON_SECRET;
    assert.equal(authorizedOfficialSnapshotRequest({}), false);
    process.env.CRON_SECRET = 'test-secret';
    assert.equal(authorizedOfficialSnapshotRequest({ headers: { authorization: 'Bearer test-secret' } }), true);
    assert.equal(authorizedOfficialSnapshotRequest({ headers: { authorization: 'Bearer wrong' } }), false);
    const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
    assert.equal(vercel.crons.find(r => r.path === '/api/cron/points-official-snapshots').schedule, '* * * * *');
  } finally {
    if (oldSecret == null) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = oldSecret;
    if (oldEnv == null) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldEnv;
  }
});


test('Sunday threshold market is selected by the cron and replays its closing score after later updates', async () => {
  // No connection string: this disposable PGlite database lives entirely in memory.
  const localDb = new PGlite();
  const thresholdCfg = automaticConfig(RT_THRESHOLD_KIND, {
    cutoff: '2026-10-26T05:59:00Z', film: 'you-can-see-everything-2026', threshold: 95,
  });
  const url = RT_THRESHOLD_FILMS[thresholdCfg.film].url;
  const thresholdPayload = { state: 'scored', score: 95, reviewCount: 130, evidenceUrl: url,
    documents: [{ url, sha256: 'a'.repeat(64) }],
    startedAt: '2026-10-26T05:58:05Z', capturedAt: '2026-10-26T05:58:08Z' };
  try {
    await localDb.exec(`CREATE TABLE points_markets (id INTEGER PRIMARY KEY, parent_id INTEGER,
      status TEXT, resolver_type TEXT, resolver_config JSONB, outcomes JSONB); ${ddl};`);
    await localDb.query(`INSERT INTO points_markets (id,status,resolver_type,resolver_config,outcomes)
      VALUES (2,'active','api_chart',$1::jsonb,$2::jsonb)`, [JSON.stringify(thresholdCfg), JSON.stringify(['Sí', 'No'])]);
    const report = await runOfficialSnapshots({}, { sql: localDb, ensureSchema: async () => {},
      clock: () => new Date(thresholdPayload.startedAt),
      collect: async config => { assert.deepEqual(config, thresholdCfg); return { payload: thresholdPayload, archive: [] }; },
    });
    assert.deepEqual(report.written, [2]);
    const result = await readCutoffResult(thresholdCfg, ['Sí', 'No'], { sql: localDb, marketId: 2, now: new Date('2026-10-28') });
    assert.equal(result.winningIdx, 1);
    assert.equal(result.resolverInfo.finalScore, 'Tomatometer 95% · Rotten Tomatoes · 130 críticas');
  } finally { await localDb.close(); }
});
