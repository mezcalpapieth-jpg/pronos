import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { TRADE_REQUEST_SCHEMA } from './trade-request-store.js';
import { SEPOLIA_GAS_SCHEMA } from './sepolia-gas-store.js';
import { sepoliaGasSettings } from './sepolia-gas-config.js';
import { collectOnchainOperations, onchainOperationsSettings } from './onchain-operations.js';
import { requirePointsAdmin } from './points-admin.js';
import { createSessionToken } from './session.js';
import { applyCors } from './cors.js';

const address = char => `0x${char.repeat(40)}`;
const v1 = address('1'), v2 = address('2'), wallet = address('3'), funder = address('4');
const hash = char => `0x${char.repeat(64)}`;
const env = { ONCHAIN_DURABLE_TRADES_ENABLED: 'true', ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true',
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  ONCHAIN_RPC_URL: 'http://never-used', DATABASE_URL: 'postgresql://unused@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_MARKET_FACTORY_ADDRESS: v1, ONCHAIN_MARKET_FACTORY_V2_ADDRESS: v2,
  ONCHAIN_AUTO_GAS_FUNDING_ENABLED: 'true', ONCHAIN_GAS_FUNDER_ADDRESS: funder, ONCHAIN_GAS_FUNDER_SUBORG_ID: 'private-suborg',
  TURNKEY_POLICIES_ENABLED: 'true', TURNKEY_ORGANIZATION_ID: 'private-org', TURNKEY_API_PUBLIC_KEY: 'fixture-public', TURNKEY_API_PRIVATE_KEY: 'private-key' };

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  for (const ddl of [...TRADE_REQUEST_SCHEMA, ...SEPOLIA_GAS_SCHEMA]) await db.exec(ddl);
  await db.exec(`CREATE TABLE protocol_markets (id int PRIMARY KEY, chain_id int, pool_address text);
    CREATE TABLE trades (market_id int, tx_hash text, trader text, side text);
    CREATE TABLE redemptions (market_id int, tx_hash text, user_address text);
    CREATE TABLE indexer_factory_state (chain_id int, factory_address text, last_block bigint, updated_at timestamptz);
    CREATE TABLE preview_indexer_runs (id uuid, status text, started_at timestamptz, completed_at timestamptz);`);
  for (const factory of [v1, v2]) await db.query('INSERT INTO indexer_factory_state VALUES (421614,$1,990,now())', [factory]);
  await db.query("INSERT INTO preview_indexer_runs VALUES ($1,'ok',now(),now())", [randomUUID()]);
  await db.query(`INSERT INTO sepolia_gas_transfers VALUES ($1,421614,$2,$3,'private-suborg',$4,50000000000000,90000000000000,0,'private-gas-signed','confirmed',now(),now())`,
    [hash('a'), funder, wallet, sepoliaGasSettings(env).signerKeyHash]);
  const f = { db, env: { ...env }, queries: [], rpc: [], chain: 421614, head: 1000, balance: '0.1' };
  f.sql = async (strings, ...values) => {
    const query = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
    f.queries.push(query); return (await db.query(query, values)).rows;
  };
  f.provider = {
    async getNetwork() { f.rpc.push('network'); return { chainId: f.chain }; },
    async getBlockNumber() { f.rpc.push('head'); return f.head; },
    async getCode() { f.rpc.push('code'); return '0x'; },
    async getBalance() { f.rpc.push('balance'); return ethers.utils.parseEther(f.balance); },
  };
  f.read = () => collectOnchainOperations({ sql: f.sql, provider: f.provider, env: f.env });
  f.addRequest = async ({ status = 'pending', action = 'buy', minutes = 10, txStatus, txHash = hash('b'), step = 'trade', owner = wallet } = {}) => {
    const id = randomUUID();
    await db.query(`INSERT INTO sepolia_trade_requests
      (id,chain_id,wallet_address,suborg_id,request_key,action,payload_hash,payload,plan,status,created_at,updated_at)
      VALUES ($1,421614,$2,'private-suborg',$7,$3,'private-payload-hash','{"private":"payload"}',
        $4::jsonb,$5,now()-$6*interval '1 minute',now()-$6*interval '1 minute')`,
    [id, owner, action, JSON.stringify({ market: { chain_address: v1 }, private: 'private-plan' }), status, minutes, `request-${id}`]);
    if (txStatus) await db.query(`INSERT INTO sepolia_trade_transactions
      (request_id,step,chain_id,wallet_address,nonce,unsigned_tx,tx_hash,signed_tx,status)
      VALUES ($1,$2,421614,$3,0,'private-unsigned',$4,$5,$6)`,
    [id, step, owner, txStatus === 'reserved' ? null : txHash, txStatus === 'reserved' ? null : 'private-signed', txStatus]);
    return id;
  };
  return f;
}

test('healthy snapshot executes only SELECTs, preserves ledgers and returns no private capabilities', async t => {
  const f = await fixture(t);
  await f.addRequest({ status: 'confirmed', txStatus: 'confirmed' });
  await f.db.query('INSERT INTO protocol_markets VALUES (1,421614,$1)', [v1]);
  await f.db.query("INSERT INTO trades VALUES (1,$1,$2,'buy')", [hash('b'), wallet]);
  const snapshot = async () => (await f.db.query(`SELECT row_to_json(r) FROM sepolia_trade_requests r
    UNION ALL SELECT row_to_json(t) FROM sepolia_trade_transactions t
    UNION ALL SELECT row_to_json(g) FROM sepolia_gas_transfers g`)).rows;
  const before = await snapshot(), report = await f.read();
  assert.equal(report.status, 'ok'); assert.deepEqual(report.issues, []);
  assert.equal(report.sections.gas.signerVerified, true);
  assert.equal(report.sections.indexer.factories[0].lagBlocks, 10);
  assert.equal(report.sections.gas.dailyBudgetUsedEth, '0.00009');
  assert.ok(f.queries.every(q => /^\s*SELECT\b/i.test(q)));
  assert.ok(f.queries.every(q => !/signed_tx|unsigned_tx|SELECT\s+\*/i.test(q)));
  assert.doesNotMatch(JSON.stringify(report), /private-|signerKeyHash|suborg|payload_hash|unsigned_tx|signed_tx/);
  assert.deepEqual(await snapshot(), before);
});

test('nonce conflicts are immediate and ordered before old pending requests; fresh requests are quiet', async t => {
  const f = await fixture(t);
  const old = await f.addRequest(), conflict = await f.addRequest({ minutes: 0, txStatus: 'needs_reconciliation' });
  const fresh = await f.addRequest({ minutes: 0 });
  const report = await f.read(), rows = report.sections.trades.requests;
  assert.equal(report.status, 'critical'); assert.deepEqual(rows.map(r => r.id), [conflict, old]);
  assert.equal(rows[0].reason, 'needs_reconciliation'); assert.equal(rows[0].nonce, '0');
  assert.ok(!rows.some(r => r.id === fresh));
  assert.match(report.issues[0].nextAction, /Do not create a replacement/);
});

test('confirmed indexing matches the correct chain, pool, wallet and buy/sell side', async t => {
  const f = await fixture(t), id = await f.addRequest({ status: 'confirmed', txStatus: 'confirmed' });
  for (const [chain, pool, owner, side] of [[1,v1,wallet,'buy'], [421614,v2,wallet,'buy'], [421614,v1,funder,'buy'], [421614,v1,wallet,'sell']]) {
    await f.db.exec('DELETE FROM protocol_markets; DELETE FROM trades;');
    await f.db.query('INSERT INTO protocol_markets VALUES (1,$1,$2)', [chain,pool]);
    await f.db.query('INSERT INTO trades VALUES (1,$1,$2,$3)', [hash('b'),owner,side]);
    assert.equal((await f.read()).sections.trades.requests[0].id, id);
  }
  await f.db.query("UPDATE trades SET side='buy'");
  assert.deepEqual((await f.read()).sections.trades.requests, []);
});

test('redemptions and unparsed confirmed outcomes remain distinct from pending execution', async t => {
  const f = await fixture(t), id = await f.addRequest({ status: 'confirmed', action: 'redeem', txStatus: 'confirmed' });
  const unparsed = await f.addRequest({ status: 'needs_reconciliation', minutes: 0, owner: funder });
  let report = await f.read();
  assert.equal(report.sections.trades.requests.find(r => r.id === id).reason, 'awaiting_indexing');
  assert.equal(report.sections.trades.requests.find(r => r.id === unparsed).reason, 'needs_reconciliation');
  await f.db.query('INSERT INTO protocol_markets VALUES (1,421614,$1)', [v1]);
  await f.db.query('INSERT INTO redemptions VALUES (1,$1,$2)', [hash('b'),wallet]);
  report = await f.read(); assert.ok(!report.sections.trades.requests.some(r => r.id === id));
});

test('a bounded queue explicitly reports truncation and never claims full health', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 52; i++) await f.addRequest();
  const report = await f.read();
  assert.equal(report.sections.trades.requests.length, 50);
  assert.equal(report.sections.trades.truncated, true);
  assert.ok(report.issues.some(i => i.id === 'trades:truncated')); assert.notEqual(report.status, 'ok');
});

test('worker failure, missing factory, block lag and reserve shortage surface together', async t => {
  const f = await fixture(t); f.balance = '0.001'; f.head = 100000;
  await f.db.query('DELETE FROM indexer_factory_state WHERE factory_address=$1', [v2]);
  await f.db.exec("UPDATE preview_indexer_runs SET status='error'");
  const report = await f.read();
  for (const id of ['indexer:factory:1','indexer:factory:2','indexer:worker','gas:readiness']) assert.ok(report.issues.some(i => i.id === id));
  assert.equal(report.status, 'critical'); assert.equal(report.sections.gas.ready, false);
});

test('stale timestamps warn even when checkpoints are at head; budget and pending gas block readiness', async t => {
  const f = await fixture(t);
  await f.db.exec("UPDATE indexer_factory_state SET updated_at=now()-interval '1 hour'; UPDATE preview_indexer_runs SET started_at=now()-interval '1 hour'; UPDATE sepolia_gas_transfers SET max_cost_wei=100000000000000000,status='prepared'");
  const report = await f.read(); assert.equal(report.sections.gas.pendingTransfers, 1);
  assert.equal(report.sections.gas.dailyBudgetUsedEth, '0.1');
  assert.ok(report.issues.some(i => i.id === 'indexer:worker'));
  assert.ok(report.issues.some(i => i.id === 'indexer:factory:1'));
  assert.equal(report.sections.gas.ready, false);
});

test('missing schema and RPC errors are partial unavailable evidence with sanitized errors', async t => {
  const f = await fixture(t);
  await f.db.exec('DROP TABLE preview_indexer_runs');
  f.provider.getBalance = async () => { throw new Error('postgres://private-credential@private-host'); };
  const report = await f.read();
  assert.equal(report.sections.trades.status, 'ok');
  assert.equal(report.sections.indexer.status, 'unavailable'); assert.equal(report.sections.gas.status, 'unavailable');
  assert.equal(report.status, 'critical'); assert.doesNotMatch(JSON.stringify(report), /private-credential|private-host|does not exist/);
});

test('wrong chain fails closed without balance/head probes; wrong preview configuration does not query', async t => {
  const f = await fixture(t); f.chain = 1;
  const report = await f.read(); assert.ok(report.issues.some(i => i.id === 'rpc:chain'));
  assert.deepEqual(f.rpc, ['network']); assert.notEqual(report.status, 'ok');
  for (const patch of [{ VERCEL_ENV: 'production' },{ VERCEL_GIT_COMMIT_REF: 'pointbreak' },{ ONCHAIN_CHAIN_ID: '1' },
    { ONCHAIN_DURABLE_TRADES_ENABLED: 'false' },{ DATABASE_URL: 'postgres://unused@production/neondb' },
    { DATABASE_URL: env.DATABASE_URL.replace('/neondb', '/other') }]) {
    const bad = { ...env, ...patch }; assert.equal(onchainOperationsSettings(bad).configured, false);
    await assert.rejects(collectOnchainOperations({ sql: () => assert.fail('queried disabled DB'), provider: {}, env: bad }));
  }
});

test('stalled provider reads have a deadline and do not hide healthy local ledger evidence', async t => {
  const f = await fixture(t);
  f.provider.getNetwork = () => new Promise(() => {});
  let report = await collectOnchainOperations({ sql: f.sql, provider: f.provider, env: f.env, readTimeoutMs: 50 });
  assert.ok(report.issues.some(i => i.id === 'rpc:chain'));
  assert.equal(report.sections.trades.status, 'ok'); assert.equal(report.sections.gas.status, 'unavailable');
  f.provider.getNetwork = async () => ({ chainId: 421614 });
  f.provider.getBlockNumber = f.provider.getBalance = () => new Promise(() => {});
  report = await collectOnchainOperations({ sql: f.sql, provider: f.provider, env: f.env, readTimeoutMs: 50 });
  assert.equal(report.sections.indexer.status, 'unavailable'); assert.equal(report.sections.gas.status, 'unavailable');
  assert.equal(report.sections.trades.status, 'ok'); assert.equal(report.status, 'critical');
});

test('actual HTTP handler enforces real admin auth, GET, preview guards, no overrides and rate limit before I/O', async t => {
  const f = await fixture(t);
  const saved = { ...process.env };
  process.env.POINTS_SESSION_SECRET = 'local-fixture-only-operations-secret'; process.env.POINTS_ADMIN_USERNAMES = 'operator';
  t.after(() => { for (const key of ['POINTS_SESSION_SECRET','POINTS_ADMIN_USERNAMES']) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  } });
  const token = username => createSessionToken({ suborgId: 'fixture-owner', username });
  const source = (await readFile(new URL('../points/admin/onchain-operations.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?;\n/gm, '').replace('export default ', '');
  let connects = 0, limited = false;
  const bindings = { applyCors, requirePointsAdmin, onchainOperationsSettings: () => onchainOperationsSettings(f.env),
    rateLimit: (req,res) => { if (limited) { res.status(429).json({ error: 'rate_limited' }); return true; } return false; }, clientIp: () => 'local',
    process: { env: f.env }, neon: url => { assert.equal(url, env.DATABASE_URL); connects++; return f.sql; },
    ethers: { providers: { JsonRpcProvider: class { constructor(connection) {
      assert.deepEqual(connection, { url: env.ONCHAIN_RPC_URL, timeout: 5000 }); return f.provider;
    } } } },
    collectOnchainOperations: args => collectOnchainOperations({ ...args, env: f.env }) };
  const handler = new Function(...Object.keys(bindings), `${source}\nreturn handler;`)(...Object.values(bindings));
  const request = async ({ method = 'GET', username = 'operator', query = {} } = {}) => {
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; },
      json(body) { this.body = body; return this; }, end() { return this; } };
    await handler({ method, query, headers: username ? { cookie: `pronos_points_session=${token(username)}` } : {} }, res); return res;
  };
  assert.equal((await request({ method: 'OPTIONS' })).code, 200);
  assert.equal((await request({ method: 'POST' })).code, 405);
  assert.equal((await request({ username: null })).code, 401);
  assert.equal((await request({ username: 'someone' })).code, 403);
  assert.equal((await request({ query: { chainId: '1' } })).code, 400);
  f.env.VERCEL_GIT_COMMIT_REF = 'pointbreak'; assert.equal((await request()).code, 403); f.env.VERCEL_GIT_COMMIT_REF = 'onchain-sepolia';
  f.env.ONCHAIN_RPC_URL = ''; assert.equal((await request()).code, 503); f.env.ONCHAIN_RPC_URL = env.ONCHAIN_RPC_URL;
  limited = true; assert.equal((await request()).code, 429); limited = false;
  assert.equal(connects, 0); assert.equal(f.rpc.length, 0);
  const good = await request(); assert.equal(good.code, 200); assert.equal(good.headers['Cache-Control'], 'private, no-store');
  assert.equal(good.body.readOnly, true); assert.equal(connects, 1);
  bindings.collectOnchainOperations = async () => { throw new Error('private-credential'); };
  const broken = new Function(...Object.keys(bindings), `${source}\nreturn handler;`)(...Object.values(bindings));
  const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await broken({ method: 'GET', query: {}, headers: { cookie: `pronos_points_session=${token('operator')}` } }, res);
  assert.equal(res.code, 503); assert.deepEqual(res.body, { error: 'onchain_operations_unavailable' });
});
