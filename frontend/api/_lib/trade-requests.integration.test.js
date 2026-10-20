import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { TRADE_REQUEST_SCHEMA, TRADE_REQUEST_PRIVILEGES, tradeRequestStore } from './trade-request-store.js';
import { runDurableTrade, publicTradeRequest, tradePayloadHash, tradeRequestKey } from './trade-requests.js';
import { tradeRequestSettings } from './trade-request-runtime.js';

// Deterministic, public test key. Only the in-memory RPC below can receive
// these signatures; this suite never reads env credentials or connects out.
const signer = new ethers.Wallet(`0x${'0'.repeat(63)}1`), wallet = signer.address.toLowerCase();
const destination = `0x${'2'.repeat(40)}`;
const feeQuote = async () => ({ maxFeePerGas: ethers.BigNumber.from(100), maxPriorityFeePerGas: ethers.BigNumber.from(1) });
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  const sql = async (strings, ...values) => (await db.query(strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''), values)).rows;
  for (const ddl of TRADE_REQUEST_SCHEMA) await db.exec(ddl);
  const store = tradeRequestStore(sql), receipts = new Map();
  const f = { db, store, sent: [], signed: [], prepared: 0, validated: 0, nonce: 0,
    autoConfirm: true, closed: false, failSign: false, failParse: false, approval: false, network: 421614 };
  const confirm = (raw, status = 1) => {
    const tx = ethers.utils.parseTransaction(raw);
    f.nonce = Math.max(f.nonce, tx.nonce + 1);
    const receipt = { transactionHash: tx.hash, blockNumber: 100 + tx.nonce, status, logs: [] };
    receipts.set(tx.hash, receipt); return receipt;
  };
  const provider = {
    getNetwork: async () => ({ chainId: f.network }),
    getTransactionCount: async (_a, kind) => kind === 'pending' && f.externalPending ? f.nonce + 1 : f.nonce,
    getTransactionReceipt: async hash => receipts.get(hash) || null,
    async sendTransaction(raw) {
      const parsed = ethers.utils.parseTransaction(raw);
      // Assert the payload/hash is already durable at the broadcast boundary.
      const rows = await sql`SELECT signed_tx FROM sepolia_trade_transactions WHERE tx_hash = ${parsed.hash}`;
      assert.equal(rows[0]?.signed_tx, raw);
      f.sent.push(raw);
      if (f.autoConfirm) confirm(raw, f.revert ? 0 : 1);
      if (f.sendTimeout) throw Error('RPC response lost after accepting transaction');
    },
    waitForTransaction: async hash => receipts.get(hash) || null,
  };
  const base = { store, provider, wallet, suborg: 'owner', key: 'request-0001', action: 'buy', payload: { amount: 10 }, feeQuote, waitMs: 1,
    async sign(args) {
      f.signed.push(args.unsignedTx);
      if (f.onSign) await f.onSign(args);
      if (f.failSign) throw Error('signer timeout');
      const tx = ethers.utils.parseTransaction(args.unsignedTx);
      return signer.signTransaction({ to: tx.to, nonce: tx.nonce, gasLimit: tx.gasLimit, type: 2,
        chainId: tx.chainId, data: tx.data, value: tx.value, maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas, accessList: tx.accessList });
    },
    prepare: async () => { f.prepared++; if (f.closed) throw Object.assign(Error('market_closed'), { status: 400 }); return { amount: 10 }; },
    validate: async () => { f.validated++; if (f.closed) throw Object.assign(Error('market_closed'), { status: 400 }); },
    async execute(plan, execution) {
      const call = { suborgId: 'owner', from: wallet, to: destination, data: '0x1234' };
      if (!execution.receipt && f.approval) await execution.send({ ...call, data: '0x5678', step: 'collateral_approval' });
      const receipt = execution.receipt || await execution.send({ ...call, step: 'trade' });
      if (f.failParse) throw Error('event_not_found');
      return { ok: true, mode: 'protocol', txHash: receipt.transactionHash, blockNumber: receipt.blockNumber, sharesOut: plan.amount * 2 };
    },
  };
  return Object.assign(f, { sql, base, confirm, run: overrides => runDurableTrade({ ...base, ...overrides }) });
}

test('lost HTTP response replays one completed trade even after market closure', async t => {
  const f = await fixture(t), first = await f.run(); f.closed = true;
  const replay = await f.run();
  assert.equal(first.httpStatus, 200); assert.deepEqual(replay, first);
  assert.equal(f.prepared, 1); assert.equal(f.sent.length, 1); assert.equal(f.signed.length, 1);
  assert.equal(first.body.indexingStatus, 'pending');
});
test('RPC timeout rebroadcasts only persisted bytes and nonce, across a fresh store instance', async t => {
  const f = await fixture(t); f.autoConfirm = false;
  assert.equal((await f.run()).httpStatus, 202);
  f.autoConfirm = true; f.closed = true;
  const replay = await f.run({ store: tradeRequestStore(f.sql) });
  assert.equal(replay.httpStatus, 200); assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0], f.sent[1]); assert.equal(f.signed.length, 1); assert.equal(f.prepared, 1);
});
test('broadcast error after acceptance reconciles the receipt without a second signature', async t => {
  const f = await fixture(t); f.sendTimeout = true;
  assert.equal((await f.run()).httpStatus, 200); assert.equal(f.signed.length, 1);
});
test('a reserved nonce survives signer timeout; retry signs the identical unsigned transaction', async t => {
  const f = await fixture(t); f.failSign = true;
  assert.equal((await f.run()).httpStatus, 202); assert.equal(f.sent.length, 0);
  const [reserved] = await f.store.transactions((await f.store.find(wallet, f.base.key)).id);
  assert.equal(reserved.status, 'reserved'); assert.equal(reserved.nonce, 0);
  f.failSign = false; assert.equal((await f.run()).httpStatus, 200);
  assert.equal(f.signed[0], f.signed[1]);
});
test('approval and economic action use separate durable steps and sequential wallet nonces', async t => {
  const f = await fixture(t); f.approval = true;
  assert.equal((await f.run()).httpStatus, 200);
  assert.equal((await f.run({ key: 'request-0002', action: 'sell' })).httpStatus, 200);
  assert.equal((await f.run({ key: 'request-0003', action: 'redeem' })).httpStatus, 200);
  assert.deepEqual(f.sent.map(raw => ethers.utils.parseTransaction(raw).nonce), [0,1,2,3,4,5]);
});
test('concurrent HTTP retries have one signer and one economic transaction', async t => {
  const f = await fixture(t);
  let release; const paused = new Promise(resolve => { release = resolve; });
  let entered; const signing = new Promise(resolve => { entered = resolve; });
  f.onSign = async () => { entered(); await paused; };
  const first = f.run(); await signing;
  const duplicate = await f.run();
  assert.equal(duplicate.httpStatus, 202); assert.equal(f.signed.length, 1);
  release(); assert.equal((await first).httpStatus, 200);
  assert.equal(f.sent.length, 1);
});
test('an unsettled trade blocks another request, including after the wallet lease expires', async t => {
  const f = await fixture(t); f.autoConfirm = false;
  await f.run();
  await f.db.exec("UPDATE sepolia_trade_wallet_leases SET lease_until = now() - interval '1 second'");
  const next = await f.run({ key: 'request-0002' });
  assert.equal(next.httpStatus, 409); assert.equal(next.body.error, 'trade_wallet_busy');
  assert.equal(f.signed.length, 1); assert.equal(f.prepared, 1);
});
test('changed immutable payload/action and changed owner cannot reuse a request key', async t => {
  const f = await fixture(t); await f.run();
  for (const changes of [{ payload: { amount: 11 } }, { action: 'sell' }, { suborg: 'other' }]) {
    await assert.rejects(f.run(changes), { message: 'idempotency_key_conflict' });
  }
  assert.equal(f.sent.length, 1);
});
test('mined transaction with missing parser output stays reconcilable and never reexecutes', async t => {
  const f = await fixture(t); f.failParse = true;
  const pending = await f.run();
  assert.equal(pending.httpStatus, 202); assert.equal(pending.body.status, 'needs_reconciliation');
  assert.ok(pending.body.txHash); f.failParse = false; f.closed = true;
  assert.equal((await f.run()).httpStatus, 200); assert.equal(f.sent.length, 1);
});
test('a reverted trade is terminal for its request ID', async t => {
  const f = await fixture(t); f.revert = true;
  const first = await f.run(), second = await f.run();
  assert.equal(first.httpStatus, 409); assert.equal(first.body.status, 'reverted');
  assert.deepEqual(second, first); assert.equal(f.sent.length, 1);
});
test('external nonce consumption holds the wallet for reconciliation without signing a replacement', async t => {
  const f = await fixture(t); f.autoConfirm = false; await f.run(); f.nonce = 1;
  const ambiguous = await f.run();
  assert.equal(ambiguous.body.status, 'needs_reconciliation'); assert.equal(ambiguous.body.error, 'trade_nonce_conflict');
  assert.equal((await f.run({ key: 'request-0002' })).httpStatus, 409);
  assert.equal(f.signed.length, 1); assert.equal(f.sent.length, 1);
  // A delayed receipt for the original hash can safely clear the uncertainty.
  f.confirm(f.sent[0]); assert.equal((await f.run()).httpStatus, 200);
});
test('an external pending nonce and wrong RPC chain cannot create a new signature', async t => {
  const f = await fixture(t); f.externalPending = true;
  assert.equal((await f.run()).httpStatus, 202); assert.equal(f.signed.length, 0);
  f.network = 42161;
  await assert.rejects(f.run({ key: 'request-0002' }), { message: 'trade_wrong_chain' });
});
test('stale workers cannot persist signatures or release the successor wallet lease', async t => {
  const f = await fixture(t), successor = randomUUID();
  f.onSign = async () => {
    await f.db.exec("UPDATE sepolia_trade_wallet_leases SET lease_until = now() - interval '1 second'");
    assert.equal(await f.store.acquire(wallet, successor), true);
  };
  await assert.rejects(f.run(), { status: 202 });
  assert.equal(f.sent.length, 0);
  assert.equal(await f.store.acquire(wallet, randomUUID()), false);
  assert.equal((await f.db.query('SELECT signed_tx FROM sepolia_trade_transactions')).rows[0].signed_tx, null);
});
test('wallet leases are independent and database constraints fence two unresolved nonces', async t => {
  const f = await fixture(t), token = randomUUID(), entry = await f.store.create({ id: randomUUID(), wallet,
    suborg: 'owner', key: 'request-0001', action: 'buy', hash: 'hash', payload: {} });
  assert.equal(await f.store.acquire(wallet, token), true);
  assert.equal(await f.store.acquire(destination, randomUUID()), true);
  assert.ok(await f.store.reserve(entry, token, { step: 'trade', nonce: 0, unsigned: 'test' }));
  await assert.rejects(f.store.reserve(entry, token, { step: 'share_approval', nonce: 1, unsigned: 'test' }), /unique/i);
  await f.db.exec("UPDATE sepolia_trade_wallet_leases SET lease_until = now() - interval '1 second'");
  assert.equal(await f.store.reserve(entry, token, { step: 'share_approval', nonce: 2, unsigned: 'test' }), undefined);
});
test('public serialization excludes signed bytes, payloads, wallet, suborg and internal IDs', async t => {
  const f = await fixture(t); await f.run();
  const entry = await f.store.find(wallet, f.base.key), transactions = await f.store.transactions(entry.id);
  const result = JSON.stringify(publicTradeRequest(entry, transactions, true));
  for (const secret of ['signed_tx','unsigned_tx','payload','suborg','wallet_address',entry.id,transactions[0].signed_tx]) {
    assert.equal(result.includes(secret), false);
  }
  assert.equal(JSON.parse(result).status, 'indexed');
});
test('request key validation, stable payload hashing and preview gates', () => {
  assert.equal(tradePayloadHash({ b: 2, a: 1 }), tradePayloadHash({ a: 1, b: 2 }));
  for (const key of [undefined, 'short', {}, 'bad spaces', 'a'.repeat(129)]) assert.throws(() => tradeRequestKey({ body: { requestId: key } }));
  assert.equal(tradeRequestKey({ headers: { 'idempotency-key': 'request_0001' } }), 'request_0001');
  assert.throws(() => tradeRequestKey({ headers: { 'idempotency-key': 'request_0001' }, body: { requestId: 'request_0002' } }));
  const env = { ONCHAIN_DURABLE_TRADES_ENABLED: 'true', ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true',
    VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
    ONCHAIN_RPC_URL: 'http://unused', DATABASE_URL: 'postgresql://unused@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb' };
  assert.deepEqual(tradeRequestSettings(env), { enabled: true, configured: true });
  for (const changes of [{ VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'pointbreak' }, { ONCHAIN_CHAIN_ID: '42161' }]) {
    assert.equal(tradeRequestSettings({ ...env, ...changes }).enabled, false);
  }
  assert.deepEqual(tradeRequestSettings({ ...env, DATABASE_URL: 'postgresql://unused@production/db' }), { enabled: true, configured: false });
});

test('an unsigned reserved trade rejected after closure releases the wallet without spending gas', async t => {
  const f = await fixture(t); f.failSign = true; await f.run(); f.closed = true;
  const rejected = await f.run();
  assert.equal(rejected.httpStatus, 400); assert.equal(rejected.body.status, 'rejected');
  assert.equal(await f.store.unsettled(wallet), undefined); assert.equal(f.sent.length, 0);
  assert.deepEqual(await f.run(), rejected);
  f.closed = false; f.failSign = false;
  assert.equal((await f.run({ key: 'request-0002' })).httpStatus, 200);
  assert.equal(ethers.utils.parseTransaction(f.sent[0]).nonce, 0);
});
test('approval-only crash recovery reconciles its saved nonce before the trade even if allowance checks change', async t => {
  const f = await fixture(t); f.approval = true; f.autoConfirm = false;
  assert.equal((await f.run()).httpStatus, 202);
  const original = f.sent[0]; f.confirm(original); f.approval = false; f.autoConfirm = true;
  assert.equal((await f.run()).httpStatus, 200);
  assert.deepEqual(f.sent.map(raw => ethers.utils.parseTransaction(raw).nonce), [0,1]);
});
test('stale RPC nonce data cannot reuse a confirmed nonce in another request', async t => {
  const f = await fixture(t); await f.run(); f.nonce = 0;
  assert.equal((await f.run({ key: 'request-0002' })).httpStatus, 202);
  assert.equal(f.signed.length, 1);
  f.nonce = 1; assert.equal((await f.run({ key: 'request-0002' })).httpStatus, 200);
  assert.deepEqual(f.sent.map(raw => ethers.utils.parseTransaction(raw).nonce), [0,1]);
});

test('migration removes inherited reader access to signed bytes and permits app reservation cleanup', async t => {
  const db = new PGlite(); t.after(() => db.close());
  for (const role of ['pronos_writer','pronos_reader','sepolia_indexer','sepolia_standings']) await db.exec(`CREATE ROLE ${role}`);
  await db.exec('ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO pronos_reader');
  await db.exec('BEGIN');
  for (const ddl of [...TRADE_REQUEST_SCHEMA, ...TRADE_REQUEST_PRIVILEGES]) await db.exec(ddl);
  await db.exec('COMMIT');
  const tables = ['sepolia_trade_requests','sepolia_trade_wallet_leases','sepolia_trade_transactions'];
  for (const role of ['pronos_reader','sepolia_indexer','sepolia_standings']) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of tables) await assert.rejects(db.query(`SELECT * FROM ${table}`), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE pronos_writer');
  for (const table of tables) {
    await db.query(`SELECT * FROM ${table}`);
    await db.query(`DELETE FROM ${table} WHERE false`);
  }
  await db.exec('RESET ROLE');
});
