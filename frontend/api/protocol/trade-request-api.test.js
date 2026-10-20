import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { protocolTradeRequest, tradeRequestSettings, tradeRequestWallet } from '../_lib/trade-request-runtime.js';
import { tradeError, tradeRequestKey, publicTradeRequest } from '../_lib/trade-requests.js';
import { TRADE_REQUEST_SCHEMA, tradeRequestStore } from '../_lib/trade-request-store.js';
import { defaultMinSharesOut, defaultMinCollateralOut, enforceProtocolBuySlippage,
  enforceProtocolSellSlippage, optionalFiniteNumber } from '../_lib/protocol-trade-guards.js';

const strip = source => source.replace(/^import[\s\S]*?;\n/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');
const sources = Object.fromEntries(await Promise.all(['buy','sell','redeem','trade-request'].map(async action =>
  [action, strip(await readFile(new URL(`./${action}.js`, import.meta.url), 'utf8'))])));
const validationSource = strip(await readFile(new URL('../_lib/trade-request-validation.js', import.meta.url), 'utf8'));
const signer = new ethers.Wallet(`0x${'0'.repeat(63)}1`), wallet = signer.address.toLowerCase(), pool = `0x${'2'.repeat(40)}`;
const env = { ONCHAIN_DURABLE_TRADES_ENABLED: 'true', ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true',
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  ONCHAIN_RPC_URL: 'http://never-used', DATABASE_URL: 'postgresql://unused@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb' };

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  for (const ddl of TRADE_REQUEST_SCHEMA) await db.exec(ddl);
  await db.exec(`CREATE TABLE points_users (wallet_address text, turnkey_sub_org_id text);
    CREATE TABLE protocol_markets (id integer PRIMARY KEY, question text, status text, pool_address text,
      outcomes jsonb, outcome_count integer, start_time timestamptz, end_time timestamptz, created_at timestamptz,
      protocol_version text, chain_id integer, resolver_type text, resolver_config jsonb, sport text, league text);
    CREATE TABLE trades (market_id integer, tx_hash text, trader text, side text);
    CREATE TABLE redemptions (market_id integer, tx_hash text, user_address text);`);
  await db.query('INSERT INTO points_users VALUES ($1,$2)', [wallet,'owner']);
  await db.query("INSERT INTO protocol_markets (id,status,pool_address,outcomes,chain_id) VALUES (3,'active',$1,'[\"Yes\",\"No\"]',421614)", [pool]);
  const queries = [], receipts = new Map();
  const sql = async (strings, ...values) => {
    const text = strings.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, '');
    queries.push(text); return (await db.query(text, values)).rows;
  };
  const f = { db, sql, queries, sent: [], nonce: 0, quotes: 0, joins: 0, autoConfirm: true };
  const provider = {
    getNetwork: async () => ({ chainId: 421614 }),
    getTransactionCount: async () => f.nonce,
    getGasPrice: async () => ethers.BigNumber.from(100),
    getFeeData: async () => ({ maxFeePerGas: ethers.BigNumber.from(100), maxPriorityFeePerGas: ethers.BigNumber.from(1) }),
    getTransactionReceipt: async hash => receipts.get(hash) || null,
    waitForTransaction: async hash => receipts.get(hash) || null,
    async sendTransaction(raw) {
      const tx = ethers.utils.parseTransaction(raw); f.sent.push(raw);
      if (f.autoConfirm) { f.nonce = tx.nonce + 1; receipts.set(tx.hash, { status: 1, transactionHash: tx.hash, blockNumber: 100, logs: [] }); }
    },
  };
  const send = async ({ execution, ...plan }) => {
    const receipt = execution.receipt || await execution.send({ suborgId: plan.suborgId, from: plan.ownerAddr, to: pool, data: '0x1234', step: 'trade' });
    return { sharesOut: 20, fee: 0.25, collateralOut: 9, txHash: receipt.transactionHash, blockNumber: receipt.blockNumber };
  };
  const bindings = { neon: () => sql, process: { env }, console: { error() {} },
    applyCors: () => null, requireSession: (req, res) => {
      if (!req.session) { res.status(401).json({ error: 'not_authenticated' }); return null; } return req.session;
    },
    rateLimit: () => false, clientIp: () => 'local', tradeError, tradeRequestKey, publicTradeRequest, tradeRequestWallet,
    tradeRequestSettings: () => tradeRequestSettings(env), tradeRequestStore,
    async protocolTradeRequest(args) {
      return protocolTradeRequest(args, { env, sqlFor: url => { assert.equal(url, env.DATABASE_URL); return sql; },
        providerFor: () => provider, sign: async args => {
          const tx = ethers.utils.parseTransaction(args.unsignedTx);
          return signer.signTransaction({ to: tx.to, nonce: tx.nonce, gasLimit: tx.gasLimit, chainId: tx.chainId, type: 2,
            data: tx.data, value: tx.value, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas, accessList: tx.accessList });
        } });
    },
    assertTournamentTradingOpen: async () => {},
    prepareTournamentJoin: async () => { f.joins++; return { status: 'disabled' }; },
    quoteBuyOnChain: async () => { f.quotes++; return { sharesOut: 20, avgPrice: 0.4875 }; },
    quoteSellOnChain: async () => { f.quotes++; return { collateralOut: 9 }; },
    buyOnChain: send, sellOnChain: send, redeemOnChain: send,
    seriesTradeLockFromRows: () => null, defaultMinSharesOut, defaultMinCollateralOut,
    enforceProtocolBuySlippage, enforceProtocolSellSlippage, optionalFiniteNumber,
  };
  bindings.validateTradePlan = new Function('assertTournamentTradingOpen', 'tradeError', `${validationSource}\nreturn validateTradePlan;`)(bindings.assertTournamentTradingOpen, tradeError);
  const handlers = Object.fromEntries(Object.entries(sources).map(([action, source]) =>
    [action, new Function(...Object.keys(bindings), `${source}\nreturn handler;`)(...Object.values(bindings))]));
  f.request = async (action, body = {}, { session = { sub: 'owner' }, query = {}, method = action === 'trade-request' ? 'GET' : 'POST' } = {}) => {
    const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handlers[action]({ method, body, query, session, headers: {} }, res); return res;
  };
  return f;
}

test('real buy/sell/redeem handlers use durable execution and replay before mutable checks', async t => {
  const f = await fixture(t);
  for (const [action, input] of [['buy',{ collateral: 10, minSharesOut: 18 }], ['sell',{ shares: 20, minCollateralOut: 8 }], ['redeem',{ amount: 20 }]]) {
    await f.db.query('UPDATE protocol_markets SET status=$1 WHERE id=3', [action === 'redeem' ? 'resolved' : 'active']);
    const body = { requestId: `request-${action}-0001`, marketId: 3, outcomeIndex: 0, ...input };
    const first = await f.request(action, body); assert.equal(first.code, 200); assert.equal(first.body.ok, true);
    await f.db.exec("UPDATE protocol_markets SET status='closed' WHERE id=3");
    const replay = await f.request(action, body); assert.deepEqual(replay.body, first.body);
  }
  assert.equal(f.sent.length, 3); assert.equal(f.quotes, 2); assert.equal(f.joins, 1);
  assert.deepEqual(f.sent.map(raw => ethers.utils.parseTransaction(raw).nonce), [0,1,2]);
});
test('missing request key, changed input and wrong-chain markets fail before signing/funding', async t => {
  const f = await fixture(t), body = { marketId: 3, outcomeIndex: 0, collateral: 10, minSharesOut: 18 };
  assert.equal((await f.request('buy', body)).body.error, 'idempotency_key_required');
  assert.equal(f.queries.length, 0);
  await f.db.exec('UPDATE protocol_markets SET chain_id=42161 WHERE id=3');
  const rejected = await f.request('buy', { ...body, requestId: 'request-wrong-chain' });
  assert.equal(rejected.code, 400); assert.equal(rejected.body.error, 'trade_wrong_chain');
  assert.equal(f.sent.length, 0); assert.equal(f.joins, 0); assert.equal(f.quotes, 0);
  await f.db.exec('UPDATE protocol_markets SET chain_id=421614 WHERE id=3');
  assert.equal((await f.request('buy', { ...body, requestId: 'request-good-0001' })).code, 200);
  const conflict = await f.request('buy', { ...body, collateral: 11, requestId: 'request-good-0001' });
  assert.equal(conflict.code, 409); assert.equal(conflict.body.error, 'idempotency_key_conflict'); assert.equal(f.sent.length, 1);
});
test('private read-only status checks ownership, distinguishes confirmed/indexed and never returns signatures', async t => {
  const f = await fixture(t), body = { marketId: 3, outcomeIndex: 0, collateral: 10, requestId: 'request-status-0001' };
  const buy = await f.request('buy', body); assert.equal(buy.code, 200);
  const before = f.queries.length;
  const unauthenticated = await f.request('trade-request', {}, { session: null }); assert.equal(unauthenticated.code, 401);
  assert.equal(f.queries.length, before);
  const identity = await f.request('trade-request', {}, { query: { action: 'identity' } });
  assert.equal(identity.body.scope, `421614:${wallet}`);
  let state = await f.request('trade-request', {}, { query: { requestId: body.requestId } });
  assert.equal(state.body.status, 'confirmed'); assert.equal(state.headers['Cache-Control'], 'private, no-store');
  await f.db.query('INSERT INTO trades VALUES (3,$1,$2,$3)', [buy.body.txHash, wallet, 'buy']);
  state = await f.request('trade-request', {}, { query: { requestId: body.requestId } });
  assert.equal(state.body.status, 'indexed');
  assert.equal(f.queries.slice(before).every(query => query.trim().startsWith('SELECT')), true);
  for (const field of ['signed_tx','unsigned_tx','suborg_id','wallet_address','plan','payload']) assert.equal(Object.hasOwn(state.body, field), false);
  await f.db.query('INSERT INTO points_users VALUES ($1,$2)', [`0x${'3'.repeat(40)}`,'stranger']);
  const stranger = await f.request('trade-request', {}, { session: { sub: 'stranger' }, query: { requestId: body.requestId } });
  assert.equal(stranger.code, 404);
});
test('pending discovery restores only the authenticated owner input and fresh requests cannot queue duplicate trades', async t => {
  const f = await fixture(t); f.autoConfirm = false;
  const body = { marketId: 3, outcomeIndex: 0, collateral: 10, requestId: 'request-pending-0001' };
  assert.equal((await f.request('buy', body)).code, 202);
  const second = await f.request('buy', { ...body, requestId: 'request-pending-0002' });
  assert.equal(second.code, 409); assert.equal(second.body.status, 'rejected'); assert.equal(f.sent.length, 1);
  const pending = await f.request('trade-request', {}, { query: { action: 'pending' } });
  assert.equal(pending.body.request.body.requestId, body.requestId);
  assert.equal(pending.body.request.body.collateral, 10); assert.equal(pending.body.request.action, 'buy');
  assert.equal(JSON.stringify(pending.body).includes('signed_tx'), false);
});
test('an account change between identity lookup and POST cannot trade from the new wallet', async t => {
  const f = await fixture(t);
  const response = await f.request('buy', { marketId: 3, outcomeIndex: 0, collateral: 10,
    requestId: 'request-session-switch', requestScope: `421614:0x${'9'.repeat(40)}` });
  assert.equal(response.code, 403); assert.equal(response.body.error, 'trade_owner_changed');
  assert.equal(f.sent.length, 0); assert.equal(f.quotes, 0); assert.equal(f.joins, 0);
  assert.equal((await f.db.query('SELECT count(*) FROM sepolia_trade_requests')).rows[0].count, 0);
});
