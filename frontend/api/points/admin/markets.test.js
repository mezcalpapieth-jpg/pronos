/**
 * Static behavior checks for the admin markets list.
 *
 * Run with:
 *   node --test frontend/api/points/admin/markets.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NeonQueryPromise, SqlTemplate } from '@neondatabase/serverless';
import { PGlite } from '@electric-sql/pglite';
import { listAdminMarkets } from './markets.js';
import { preview } from '../../_lib/test-support/sepolia-settlement.mjs';

const source = await readFile(new URL('./markets.js', import.meta.url), 'utf8');

test('admin markets applies cheap curation filters before the database limit', () => {
  const categoryFilterCount = source.match(/\$\{categoryFilter\}::text IS NULL OR m\.category = \$\{categoryFilter\}::text/g)?.length || 0;
  const cryptoRapidFilterCount = source.match(/\$\{cryptoTypeFilter\}::text = '5min' AND m\.resolver_config->>'shape' = 'binary-direction'/g)?.length || 0;

  assert.ok(categoryFilterCount >= 4, 'category filter should be in every admin query branch before LIMIT');
  assert.ok(cryptoRapidFilterCount >= 4, 'crypto rapid filter should be in every admin query branch before LIMIT');
  assert.match(source, /m\.sport = \$\{sportFilter\}::text/);
  assert.match(source, /m\.league = \$\{leagueFilter\}::text/);
  assert.match(source, /\$\{cryptoTypeFilter\}::text = 'general' AND COALESCE\(m\.resolver_config->>'shape', ''\) <> 'binary-direction'/);
});

test('active admin markets sort live rows before stale active rows', () => {
  assert.match(source, /CASE WHEN \$\{filter\}::text = 'active'/);
  assert.match(source, /m\.start_time <= NOW\(\)/);
  assert.match(source, /m\.end_time > NOW\(\) THEN 0 ELSE 1 END/);
  assert.match(source, /CASE WHEN \$\{filter\}::text = 'active' THEN m\.end_time END ASC NULLS LAST/);
});

test('admin markets includes editable market and outcome image metadata', () => {
  assert.match(source, /m\.image_url/);
  assert.match(source, /imageUrl:\s*r\.image_url \|\| null/);
  assert.match(source, /outcomeImages:\s*parseJsonb\(r\.outcome_images,\s*null\)/);
});

test('Sepolia pending queue follows indexed status and returns ambiguous or missing links for review', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE points_markets (
      id int, source text, source_event_id text, question text, category text DEFAULT 'general',
      image_url text, outcomes jsonb, outcome_images jsonb, reserves jsonb, seed_liquidity numeric,
      amm_mode text, start_time timestamptz, end_time timestamptz, status text DEFAULT 'active',
      outcome int, created_at timestamptz, resolved_at timestamptz, featured bool, hidden_from_home bool,
      tournament_featured bool, is_test_market bool, resolver_type text, mode text, chain_id int,
      chain_market_id bigint, chain_address text, sport text, league text, archived_at timestamptz,
      final_score text, resolver_config jsonb, category_tags jsonb, geo_tags jsonb, topic_tags jsonb, parent_id int
    );
    CREATE TABLE points_pending_markets (id int, status text, source_data jsonb, approved_market_id int);
    CREATE TABLE points_trades (market_id int, username text);
    CREATE TABLE points_resolution_candidates (points_market_id int, status text, created_at timestamptz);
    CREATE TABLE protocol_markets (
      id serial, chain_id int, market_id int, pool_address text, factory_address text, protocol_version text,
      status text, end_time timestamptz
    );

    INSERT INTO points_markets (id, question, mode, chain_id, chain_market_id, chain_address, end_time)
    SELECT i, 'Fixture ' || i, 'onchain', 421614, i - 1,
      '0x' || lpad(i::text, 39, '0') || 'A', now() - interval '1 hour'
    FROM generate_series(1, 10) i;
    INSERT INTO points_markets (id, question, mode, end_time)
      VALUES (11, 'Offchain fixture', 'points', now() + interval '1 hour');
    INSERT INTO points_resolution_candidates VALUES (11, 'pending', now());
  `);
  const factory = preview.ONCHAIN_MARKET_FACTORY_ADDRESS;
  const otherFactory = preview.ONCHAIN_MARKET_FACTORY_V2_ADDRESS;
  async function index(pointId, status, { chainId = 421614, marketId = pointId - 1, poolId = pointId,
    factoryAddress = factory, version = 'v1', closesIn = '-1 hour' } = {}) {
    await db.query(`INSERT INTO protocol_markets (chain_id, market_id, pool_address, factory_address,
      protocol_version, status, end_time)
      VALUES ($1, $2, '0x' || lpad($3::text, 39, '0') || 'a', $4, $5, $6, now() + $7::interval)`,
    [chainId, marketId, poolId, factoryAddress, version, status, closesIn]);
  }
  await index(1, 'active');
  await index(2, 'resolved');
  await index(3, 'canceled');
  await index(4, 'disputed');
  await index(5, 'resolved', { poolId: 100 });
  await index(6, 'resolved', { chainId: 42161 });
  await index(7, 'resolved');
  await index(7, 'active', { factoryAddress: otherFactory, version: 'v2' });
  await index(8, 'active', { factoryAddress: otherFactory });
  await index(9, 'active', { closesIn: '1 hour' });
  await index(10, 'active', { marketId: 50 });

  const queries = [];
  const query = async (statement, params) => {
    queries.push(statement);
    return (await db.query(statement, params)).rows;
  };
  const sql = (strings, ...values) => new NeonQueryPromise(template => {
    const { query: statement, params } = template.toParameterizedQuery();
    return query(statement, params);
  }, new SqlTemplate(strings, values));
  sql.query = query;
  const sepolia = { status: 'pending', mode: 'onchain', chain_id: '421614' };
  async function list(query, env = preview) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await listAdminMarkets({ method: 'GET', headers: {}, query }, res, {
      env, sqlFor: () => sql, ensureSchema: async () => {}, adminFor: () => ({ username: 'admin' }),
    });
    assert.equal(res.code, 200);
    return res.body.markets;
  }

  const rows = await list(sepolia);
  assert.deepEqual(Object.fromEntries(rows.map(row => [row.id, row.onchainResolution])), {
    1: { indexedStatus: 'active', issue: null },
    5: { indexedStatus: null, issue: 'missing_mapping' },
    6: { indexedStatus: null, issue: 'missing_mapping' },
    7: { indexedStatus: null, issue: 'ambiguous_mapping' },
    8: { indexedStatus: 'active', issue: 'unsupported_mapping' },
    10: { indexedStatus: null, issue: 'missing_mapping' },
  });
  assert.equal(rows.find(row => row.id === 1).chainMarketId, '0');
  assert.deepEqual(await list({ ...sepolia, q: '#2' }), []);
  await db.exec("UPDATE protocol_markets SET status = 'resolved' WHERE chain_id = 421614 AND market_id = 0");
  assert.deepEqual(await list({ ...sepolia, q: '#1' }), []);

  queries.length = 0;
  const offchain = await list({ status: 'pending' });
  assert.deepEqual(offchain.map(row => row.id), [11]);
  assert.equal(Object.hasOwn(offchain[0], 'onchainResolution'), false);
  const otherBranch = await list({ ...sepolia, q: '#2' }, { ...preview, VERCEL_GIT_COMMIT_REF: 'pointbreak' });
  assert.deepEqual(otherBranch.map(row => row.id), [2]);
  assert.equal(queries.some(statement => statement.includes('protocol_markets')), false);
});
