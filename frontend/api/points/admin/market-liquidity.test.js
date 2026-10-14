import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { addPointsMarketFunding, previewPointsMarketFunding } from '../../_lib/points-market-funding.js';
import { createMarketLiquidityHandler } from './market-liquidity.js';

const reserves = [319.139211, 11.707936, 2619.071733, 2619.071733, 2619.071733, 115.646882, 2619.071733, 3346.351733, 3346.351733];
const requestId = '11111111-1111-4111-8111-111111111111';
const schema = await readFile(new URL('../../_lib/points-schema.js', import.meta.url), 'utf8');
const fundingDdl = schema.match(/`(CREATE TABLE IF NOT EXISTS points_market_funding[\s\S]*?)`/)[1];
const service = await readFile(new URL('../../_lib/points-market-funding.js', import.meta.url), 'utf8');

async function database() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE points_markets (
    id INTEGER PRIMARY KEY, question TEXT, outcomes JSONB, reserves JSONB,
    mode TEXT DEFAULT 'points', chain_id INTEGER, chain_address TEXT,
    parent_id INTEGER, amm_mode TEXT DEFAULT 'unified', status TEXT DEFAULT 'active',
    end_time TIMESTAMPTZ, archived_at TIMESTAMPTZ, seed_liquidity NUMERIC, seed_liquidities JSONB
  );
  CREATE TABLE points_price_snapshots (market_id INTEGER, prices JSONB, reserves JSONB, snapshotted_at TIMESTAMPTZ);
  CREATE TABLE points_positions (market_id INTEGER, username TEXT, shares NUMERIC, cost_basis NUMERIC, realized_pnl NUMERIC);
  CREATE TABLE points_balances (username TEXT, balance NUMERIC);
  ${fundingDdl};
  INSERT INTO points_positions VALUES (1, 'holder', 123.456, 100, 42);
  INSERT INTO points_balances VALUES ('holder', 500);`);
  await db.query('INSERT INTO points_markets (id, question, outcomes, reserves, seed_liquidity, seed_liquidities) VALUES (1, $1, $2::jsonb, $3::jsonb, 727.27, $3::jsonb)',
    ['Ballon d Or', JSON.stringify(reserves.map((_, i) => `Candidate ${i}`)), JSON.stringify(reserves)]);
  return db;
}

const args = (overrides = {}) => ({ marketId: 1, amount: 90873, expectedReserves: reserves, requestId, username: 'admin', ...overrides });
const table = async (db, name) => (await db.query(`SELECT * FROM ${name}`)).rows;

test('SQL funding atomically deepens reserves and audits without changing users or seeds', async () => {
  const db = await database();
  try {
    const before = await table(db, 'points_markets');
    const positions = await table(db, 'points_positions');
    const balances = await table(db, 'points_balances');
    const result = await db.transaction(client => addPointsMarketFunding(client, args()));
    const after = await table(db, 'points_markets');
    assert.deepEqual(after[0].reserves, result.reservesAfter);
    assert.deepEqual(after[0].seed_liquidities, before[0].seed_liquidities);
    assert.equal(after[0].seed_liquidity, before[0].seed_liquidity);
    assert.deepEqual(await table(db, 'points_positions'), positions);
    assert.deepEqual(await table(db, 'points_balances'), balances);
    assert.equal((await table(db, 'points_market_funding')).length, 1);
    assert.equal((await table(db, 'points_price_snapshots')).length, 1);
    assert.match(service, /WHERE id = \$1 \$\{lock \? 'FOR UPDATE'/);
  } finally { await db.close(); }
});

test('preview is read only, retries are idempotent, mismatched retries and stale snapshots fail', async () => {
  const db = await database();
  try {
    const preview = await previewPointsMarketFunding(db, { marketId: 1, amount: 90873 });
    assert.equal(preview.recommendedAmount, 90873);
    assert.deepEqual((await table(db, 'points_markets'))[0].reserves, reserves);
    assert.equal((await table(db, 'points_market_funding')).length, 0);
    const first = await db.transaction(client => addPointsMarketFunding(client, args()));
    const second = await db.transaction(client => addPointsMarketFunding(client, args()));
    assert.deepEqual(second, { ...first, replayed: true });
    assert.equal((await table(db, 'points_market_funding')).length, 1);
    assert.equal((await table(db, 'points_price_snapshots')).length, 1);
    await assert.rejects(db.transaction(client => addPointsMarketFunding(client, args({ amount: 10000 }))), /funding_request_conflict/);
    await assert.rejects(db.transaction(client => addPointsMarketFunding(client, args({ requestId: '22222222-2222-4222-8222-222222222222' }))), /funding_preview_stale/);
    assert.deepEqual((await table(db, 'points_markets'))[0].reserves, first.reservesAfter);
  } finally { await db.close(); }
});

test('failed snapshot write rolls back both reserves and the audit record', async () => {
  const db = await database();
  try {
    await db.exec('DROP TABLE points_price_snapshots');
    await assert.rejects(db.transaction(client => addPointsMarketFunding(client, args())));
    assert.deepEqual((await table(db, 'points_markets'))[0].reserves, reserves);
    assert.equal((await table(db, 'points_market_funding')).length, 0);
  } finally { await db.close(); }
});

test('funding rejects onchain, parallel, child, closed and expired markets', async () => {
  const db = await database();
  try {
    for (const [patch, error] of [
      ["mode = 'onchain'", 'points_funding_only'],
      ['chain_id = 42161', 'points_funding_only'],
      ["amm_mode = 'parallel'", 'unified_parent_required'],
      ['parent_id = 2', 'unified_parent_required'],
      ["status = 'resolved'", 'market_not_active'],
      ["end_time = NOW() - INTERVAL '1 minute'", 'market_expired'],
      ['archived_at = NOW()', 'market_expired'],
    ]) {
      await db.exec(`UPDATE points_markets SET mode='points', chain_id=NULL, parent_id=NULL, amm_mode='unified', status='active', end_time=NULL, archived_at=NULL; UPDATE points_markets SET ${patch};`);
      await assert.rejects(db.transaction(client => addPointsMarketFunding(client, args())), new RegExp(error));
    }
    assert.equal((await table(db, 'points_market_funding')).length, 0);
  } finally { await db.close(); }
});

function response() {
  return { code: null, data: null, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; }, end() { return this; } };
}

test('HTTP handler enforces auth, CSRF and method guards before touching the database', async () => {
  let touched = false;
  const handler = createMarketLiquidityHandler({ requireAdmin(req, res) { res.status(403).json({ error: 'not_admin' }); return null; },
    ensureSchema: async () => { touched = true; }, transaction: async () => { touched = true; } });
  for (const [method, origin, code] of [['GET', null, 403], ['POST', 'https://evil.example', 403], ['DELETE', null, 405]]) {
    const res = response();
    await handler({ method, headers: { origin }, query: { marketId: 1 }, body: args() }, res);
    assert.equal(res.code, code);
  }
  assert.equal(touched, false);
});

test('HTTP preview and confirmed funding use the same SQL service and return the client contract', async () => {
  const db = await database();
  try {
    const handler = createMarketLiquidityHandler({ requireAdmin: () => ({ username: 'admin' }), ensureSchema: async () => {}, transaction: callback => db.transaction(callback) });
    const preview = response();
    await handler({ method: 'GET', headers: {}, query: { marketId: '1', amount: '90873' } }, preview);
    assert.equal(preview.code, 200);
    assert.equal(preview.headers['Cache-Control'], 'no-store');
    assert.ok(preview.data.impactsAfter.every(row => row.impactPts <= 5.000001));
    const funded = response();
    await handler({ method: 'POST', headers: {}, body: args() }, funded);
    assert.equal(funded.code, 200);
    assert.equal(funded.data.ok, true);
    assert.equal(funded.data.collateral, preview.data.plan.collateral);
    assert.deepEqual(funded.data.reservesAfter, preview.data.plan.reservesAfter);
  } finally { await db.close(); }
});

test('HTTP rejects malformed market identifiers without querying the database', async () => {
  let touched = false;
  const handler = createMarketLiquidityHandler({ requireAdmin: () => ({ username: 'admin' }),
    ensureSchema: async () => { touched = true; } });
  for (const marketId of [null, true, [1], {}, '', -1, 1.5, 'not-a-market']) {
    const res = response();
    await handler({ method: 'POST', headers: {}, body: { marketId } }, res);
    assert.equal(res.code, 400);
    assert.equal(res.data.error, 'invalid_market_id');
  }
  assert.equal(touched, false);
});
