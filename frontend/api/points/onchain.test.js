import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pendingApprovalSettings } from '../_lib/onchain-preview-approval.js';
import { tradingFactories } from '../_lib/trading-router.js';
import { marketView, portfolioView, jsonArray } from '../_lib/points-onchain-view.js';
import { lateJoinSettings } from '../_lib/sepolia-tournament-user-join.js';
import { seasonSettings } from '../_lib/sepolia-tournament-season.js';
import { tradeRequestSettings } from '../_lib/trade-request-runtime.js';

const source = (await readFile(new URL('./onchain.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\n/gm, '').replace(/^export default /gm, '').replace(/^export /gm, '');
const wallet = '0x1111111111111111111111111111111111111111';
const stranger = '0x2222222222222222222222222222222222222222';
const env = { ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  ONCHAIN_MARKET_FACTORY_ADDRESS: `0x${'a'.repeat(40)}`, ONCHAIN_MARKET_FACTORY_V2_ADDRESS: `0x${'b'.repeat(40)}`,
  ONCHAIN_COLLATERAL_ADDRESS: `0x${'c'.repeat(40)}`, ONCHAIN_RPC_URL: 'https://rpc.invalid', DATABASE_URL: 'unused' };
const mapping = { id: 360636, mode: 'onchain', chain_id: 421614, chain_address: `0x${'d'.repeat(40)}`,
  chain_market_id: '0', protocol_id: 3, protocol_chain_id: 421614, pool_address: `0x${'d'.repeat(40)}`,
  contract_market_id: 0, protocol_outcomes: ['Sí', 'No'], protocol_version: 'v1', protocol_status: 'active',
  yes_price: '0.5', no_price: '0.5', snapshot_at: '2026-10-17T10:00:00Z' };

function fixture({ patch = {}, rows = [mapping], trades = [], session = { sub: 'own-suborg' }, limited = false, rpcFails = false, rpcChain = 421614 } = {}) {
  const queries = [];
  let authCalls = 0;
  const sql = async (parts, ...values) => {
    const text = parts.join('?');
    queries.push({ text, values });
    assert.match(text.trim(), /^SELECT\b/); // no schema/account/ledger writes
    if (text.includes('FROM points_users')) return [{ wallet_address: wallet }];
    if (text.includes('FROM points_markets pm')) return rows;
    if (text.includes('FROM redemptions')) return [];
    if (text.includes('FROM trades')) return trades;
    if (text.includes('FROM protocol_markets m CROSS')) return [{ id: 3, prices: ['0.6', '0.4'], snapshot_at: '2026-10-17T10:00:00Z' }];
    throw new Error(`Unexpected query ${text}`);
  };
  const bindings = {
    neon: () => sql, applyCors: () => null, process: { env: { ...env, ...patch } },
    requireSession: (req, res) => { authCalls++; if (!session) { res.status(401).json({ error: 'not_authenticated' }); return null; } return session; },
    rateLimit: (req, res) => { if (limited) res.status(429).json({ error: 'rate_limited' }); return limited; }, clientIp: () => 'test-ip',
    pendingApprovalSettings, tradingFactories, marketView, portfolioView, jsonArray, console: { error() {} },
    lateJoinSettings:()=>lateJoinSettings({...env,...patch}),seasonSettings:()=>seasonSettings({...env,...patch}),
    tradeRequestSettings:()=>tradeRequestSettings({...env,...patch}),
    ethers: { providers: { JsonRpcProvider: class { async getNetwork() { if (rpcFails) throw new Error('down'); return { chainId: rpcChain }; } } },
      Contract: class { async balanceOf(owner) { assert.equal(owner, wallet); return '7500000'; } async decimals() { return 6; } },
      utils: { formatUnits: (value, decimals) => String(Number(value) / 10 ** decimals) } },
  };
  const { handler, adapterSettings } = new Function(...Object.keys(bindings), `${source}\nreturn { handler, adapterSettings };`)(...Object.values(bindings));
  async function request(query, method = 'GET') {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method, query, headers: {} }, res);
    return res;
  }
  return { request, queries, adapterSettings, authCalls: () => authCalls };
}

test('only the flagged onchain-sepolia preview enables the runtime; all other environments do no reads', async () => {
  for (const patch of [
    { VERCEL_ENV: 'production' }, { VERCEL_GIT_COMMIT_REF: 'pointbreak' }, { VERCEL_ENV: 'development' },
    { ONCHAIN_CHAIN_ID: '84532' }, { ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'false' }, { ONCHAIN_MARKET_FACTORY_ADDRESS: '' },
  ]) {
    const f = fixture({ patch });
    assert.equal((await f.request({ action: 'config' })).body.enabled, false);
    assert.equal((await f.request({ action: 'portfolio' })).code, 403);
    assert.equal(f.queries.length, 0); assert.equal(f.authCalls(), 0);
  }
  const f = fixture();
  assert.deepEqual((await f.request({ action: 'config' })).body, { enabled: true, chainId: 421614, symbol: 'MXNP',lateJoining:false,tournamentSeason:false,durableTrades:false });
  assert.equal(f.queries.length, 0);
});

test('tournament navigation is exposed only for the configured future preview season without SQL reads',async()=>{
  const patch={ONCHAIN_TOURNAMENT_SEASON_ENABLED:'true',ONCHAIN_TOURNAMENT_CYCLE_ID:'next-season',
    DATABASE_URL:'postgres://local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb'};
  const f=fixture({patch});assert.equal((await f.request({action:'config'})).body.tournamentSeason,true);assert.equal(f.queries.length,0);
  const production=fixture({patch:{...patch,VERCEL_ENV:'production'}});assert.equal((await production.request({action:'config'})).body.tournamentSeason,false);assert.equal(production.queries.length,0);
});

test('mapping is public, bounded and bound to the configured chain, factories and requested Points IDs', async () => {
  const f = fixture();
  const res = await f.request({ action: 'markets', ids: '360636' });
  assert.equal(res.code, 200); assert.equal(res.body.markets[0].protocolMarketId, 3);
  assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(f.authCalls(), 0);
  assert.match(f.queries[0].text, /pm\.chain_id = m\.chain_id AND LOWER\(pm\.chain_address\) = LOWER\(m\.pool_address\)/);
  assert.match(f.queries[0].text, /LOWER\(m\.factory_address\) = ANY/);
  assert.ok(f.queries[0].values.includes(421614));
  assert.ok(f.queries[0].values.some(v => Array.isArray(v) && v.includes(360636)));
  assert.ok(f.queries[0].values.some(v => Array.isArray(v) && v.includes(env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS)));
  for (const ids of ['', '0', '1,-2', '1;DROP TABLE points_users', Array(201).fill(1).join(',')]) {
    const invalid = await f.request({ action: 'markets', ids }); assert.equal(invalid.code, 400);
  }
  assert.equal(f.queries.length, 1);
});

test('preview migration retains explicitly configured historical factories in server mappings', async () => {
  const legacy = `0x${'e'.repeat(40)}`;
  const f = fixture({ patch: { ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS: legacy }, rows: [{ ...mapping, factory_address: legacy }] });
  const res = await f.request({ action: 'markets', ids: '360636' });
  assert.equal(res.body.markets[0].factoryAddress, legacy);
  assert.ok(f.queries[0].values.some(v => Array.isArray(v) && v.includes(legacy)));
  assert.equal(f.adapterSettings({ ...env, ONCHAIN_LEGACY_MARKET_FACTORY_ADDRESS: legacy }).enabled, true);
});

test('duplicate pool/Points mappings stop execution rather than choosing a row', async () => {
  for (const rows of [[mapping, mapping], [mapping, { ...mapping, id: 8 }]]) {
    const f = fixture({ rows });
    const res = await f.request({ action: 'markets', ids: '360636' });
    assert.equal(res.code, 503); assert.equal(res.body.error, 'onchain_mapping_ambiguous');
  }
});

test('portfolio ignores address overrides and scopes both immutable event logs to the session wallet', async () => {
  const f = fixture();
  const res = await f.request({ action: 'portfolio', address: stranger });
  assert.equal(res.code, 200); assert.deepEqual(res.body.positions, []); assert.equal(f.authCalls(), 1);
  assert.ok(f.queries[0].values.includes('own-suborg'));
  const eventQueries = f.queries.filter(q => /FROM (trades|redemptions)/.test(q.text));
  assert.equal(eventQueries.length, 2);
  for (const query of eventQueries) {
    assert.ok(query.values.includes(wallet)); assert.ok(!query.values.includes(stranger));
    assert.ok(query.values.some(v => Array.isArray(v) && v.includes(3)));
    assert.match(query.text, /LIMIT 10001/);
  }
  assert.ok(!JSON.stringify(res.body).includes(wallet));
});

test('private reads need a session; POST and rate-limited requests cannot reach the database', async () => {
  const missing = fixture({ session: null });
  assert.equal((await missing.request({ action: 'portfolio' })).code, 401); assert.equal(missing.queries.length, 0);
  const post = fixture();
  assert.equal((await post.request({ action: 'balance' }, 'POST')).code, 405); assert.equal(post.queries.length, 0);
  const limited = fixture({ limited: true });
  assert.equal((await limited.request({ action: 'markets', ids: '1' })).code, 429); assert.equal(limited.queries.length, 0);
});

test('token balance is read-only, private and explicit about unavailable/wrong-chain RPC', async () => {
  const f = fixture();
  const result = await f.request({ action: 'balance', address: stranger });
  assert.equal(result.code, 200); assert.equal(result.body.balance, '7.5'); assert.equal(f.queries.length, 1);
  for (const options of [{ rpcFails: true }, { rpcChain: 84532 }]) {
    const result = await fixture(options).request({ action: 'balance' });
    assert.equal(result.code, 503); assert.equal(result.body.error, 'onchain_balance_unavailable');
    assert.equal(result.body.balance, undefined);
  }
});

test('protocol snapshots return percentage history under the Points ID', async () => {
  const res = await fixture().request({ action: 'prices', ids: '360636', outcome: '1', days: '30' });
  assert.equal(res.code, 200);
  assert.deepEqual(res.body.history[360636], [{ t: 1792231200, p: 40 }]);
  assert.equal(res.body.history[3], undefined);
});

test('activity includes both binary outcomes when the detail chart requests all; tape keeps Points identities', async () => {
  const trades = [
    { market_id: 3, side: 'buy', is_yes: true, collateral_amt: 10, shares_amt: 20, fee_amt: 0, created_at: new Date().toISOString() },
    { market_id: 3, side: 'sell', is_yes: false, collateral_amt: 3, shares_amt: 5, fee_amt: 0, created_at: new Date().toISOString() },
  ];
  const f = fixture({ trades });
  const all = await f.request({ action: 'activity', ids: '360636', outcome: 'all' });
  assert.equal(all.code, 200);
  assert.equal(all.body.activity[360636].reduce((n, b) => n + b.count, 0), 2);
  assert.equal(all.body.activity[360636].reduce((n, b) => n + b.sellVolume, 0), 3);
  const yes = await f.request({ action: 'activity', ids: '360636', outcome: '0' });
  assert.equal(yes.body.activity[360636].reduce((n, b) => n + b.count, 0), 1);
  const tape = await f.request({ action: 'tape', ids: '360636' });
  assert.deepEqual(tape.body.tape[360636].map(t => [t.marketId, t.outcomeIndex]), [[360636, 0], [360636, 1]]);
});
