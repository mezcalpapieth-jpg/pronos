import assert from 'node:assert/strict';
import test from 'node:test';
import { ethers } from 'ethers';
import { PGlite } from '@electric-sql/pglite';
import handler from '../points/admin/onchain-accounting.js';
import { createSessionToken } from './session.js';
import { accountingContext, accountingSettings, accountingSummary, liquidityResult, poolMoneyEvents, transferEvents } from './onchain-accounting.js';
import { accountingMovements, accountingQuery } from './onchain-accounting-movements.js';

const address = digit => '0x' + digit.repeat(40);
const hash = number => '0x' + number.toString(16).padStart(64, '0');
const [owner, treasury, funder, factory1, factory2, pool1, pool2, token, shares, customer] = Array.from('123456789a', address);
const firstTx = hash(1);
const secondTx = hash(2);
const recoveredTx = hash(3);
const oldBlock = 700000;
const block = 800000;
const timestamp = 1800000000;
const env = {
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia', ONCHAIN_CHAIN_ID: '421614',
  DATABASE_URL: 'postgresql://fixture@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_RPC_URL: 'http://not-used.invalid', ONCHAIN_COLLATERAL_ADDRESS: token,
  ONCHAIN_MARKET_FACTORY_ADDRESS: factory1, ONCHAIN_MARKET_FACTORY_V2_ADDRESS: factory2,
  ONCHAIN_DEPLOYER_ADDRESS: owner, ONCHAIN_OWNER_ADDRESS: owner, ONCHAIN_GAS_FUNDER_ADDRESS: funder,
};

function event(iface, name, at, fields, { index = 0, tx = firstTx, blockNumber = oldBlock } = {}) {
  return { ...iface.encodeEventLog(iface.getEvent(name), fields), address: at, logIndex: index, transactionHash: tx, blockNumber };
}
const transfer = (from, to, amount, opts) => event(transferEvents, 'Transfer', token, [from, to, amount], opts);
const created = (pool, factory, sender, tx) => ({ status: 1, blockNumber: oldBlock, logs: [
  transfer(sender, factory, 100000000, { tx }),
  transfer(factory, pool, 100000000, { tx, index: 1 }),
  event(poolMoneyEvents, 'LiquidityAdded', pool, [factory, 100000000], { tx, index: 2 }),
] });

const testAbi = new ethers.utils.Interface([
  ...['collateral', 'owner', 'resolver', 'marketCreator', 'treasury', 'liquidityReserve', 'emergencyReserve', 'feeCollector', 'feeVault', 'token', 'factory']
    .map(name => 'function ' + name + '() view returns(address)'),
  ...['marketCount', 'marketId', 'outcomeCount', 'totalFeesCollected', 'totalRecovered', 'resolvedAt', 'outcome', 'totalRedeemed']
    .map(name => 'function ' + name + '() view returns(uint256)'),
  ...['canceled', 'resolved', 'disputed'].map(name => 'function ' + name + '() view returns(bool)'),
  'function decimals() view returns(uint8)', 'function symbol() view returns(string)',
  'function balanceOf(address) view returns(uint256)', 'function totalSupply(uint256) view returns(uint256)',
  'function balanceOfBatch(address[],uint256[]) view returns(uint256[])',
]);
const factories = {
  collateral: token, owner, resolver: owner, marketCreator: owner, treasury, liquidityReserve: treasury,
  emergencyReserve: treasury, feeCollector: treasury, feeVault: ethers.constants.AddressZero, marketCount: 1,
};
const pool = { collateral: token, token: shares, totalFeesCollected: 2500000, totalRedeemed: 10000000,
  resolved: true, disputed: false, canceled: false, resolvedAt: timestamp - 31 * 86400, outcome: 1, marketId: 1 };
const values = {
  [factory1]: factories, [factory2]: factories,
  [token]: { decimals: 6, symbol: 'MXNP', balanceOf: account => account === pool1 ? 20000000 : 120000000 },
  [shares]: { balanceOfBatch: (_, ids) => ids[0].eq(2) ? [0, 1000000] : [95000000, 180000000, 100000000], totalSupply: 20000000 },
  [pool1]: { ...pool, factory: factory1 },
  [pool2]: { ...pool, factory: factory2, resolved: false, outcomeCount: 3, marketId: 2, totalFeesCollected: 1500000, totalRedeemed: 0 },
};
const recoveryLog = event(poolMoneyEvents, 'DustRecovered', pool1, [treasury, 90000000], { tx: recoveredTx, index: 1 });
const provider = {
  _isProvider: true,
  resolveName: async value => value,
  getNetwork: async () => ({ chainId: 421614 }),
  getBlock: async () => ({ number: block, timestamp }),
  getBalance: async () => ethers.BigNumber.from(420000000000000),
  getTransactionReceipt: async tx => ({
    [firstTx]: created(pool1, factory1, owner, firstTx), [secondTx]: created(pool2, factory2, owner, secondTx),
  })[tx] ?? null,
  getLogs: async () => [recoveryLog],
  async call(transaction, at) {
    assert.equal(at, block);
    const call = testAbi.parseTransaction(transaction);
    const value = values[transaction.to.toLowerCase()]?.[call.name];
    if (value === undefined) throw new Error('method unsupported by legacy contract');
    return testAbi.encodeFunctionResult(call.signature, [typeof value === 'function' ? value(...call.args) : value]);
  },
};

test('snapshot reconciles V1 recovery and V2 open exposure, proves both funding legs and keeps backing outside Pronos balances', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE protocol_markets (
    id integer, chain_id integer, market_id integer, question text, pool_address text, factory_address text, tx_hash text);
    CREATE TABLE sepolia_gas_transfers (chain_id integer, funder_address text, amount_wei numeric, status text,
      tx_hash text, wallet_address text, confirmed_at timestamptz);`);
  await db.query('INSERT INTO protocol_markets VALUES (1,421614,1,\'V1?\',$1,$2,$3),(2,421614,2,\'V2?\',$4,$5,$6),(3,1,3,\'Other chain\',$4,$5,$6)',
    [pool1, factory1, firstTx, pool2, factory2, secondTx]);
  await db.query(`INSERT INTO sepolia_gas_transfers VALUES
    (421614,$1,50000000000000,'confirmed',$2,$3,'2026-10-20'),(421614,$1,50000000000000,'prepared',$4,$3,'2026-10-20')`,
    [funder, hash(8), customer, hash(9)]);
  const sql = async (parts, ...args) => {
    const query = parts.reduce((result, piece, i) => result + (i ? '$' + i : '') + piece, '');
    assert.match(query, /^\s*SELECT /);
    return (await db.query(query, args)).rows;
  };
  const context = await accountingContext({ sql, provider, env, settings: accountingSettings(env) });
  const report = await accountingSummary(context, false);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.markets[0].seed, '100.0');
  assert.equal(report.markets[0].winnerBacking, '20.0');
  assert.equal(report.markets[0].winnerPayouts, '10.0');
  assert.equal(report.markets[0].recovery, '90.0');
  assert.equal(report.markets[0].realized, '-10.0');
  assert.equal(report.markets[1].recoverable, '95.0');
  assert.equal(report.markets[1].openDownside, '5.0');
  assert.equal(report.markets[1].realized, null);
  assert.equal(report.metrics.fees.amount, '4.0');
  assert.equal(report.metrics.contribution.amount, '-6.0');
  assert.equal(report.metrics.walletMxnp.count, 4);
  assert.equal(report.metrics.walletMxnp.amount, '480.0');
  assert.equal(report.metrics.poolBalance.amount, '140.0');
  assert.equal(report.wallets.filter(wallet => wallet.address === treasury).length, 1);
  assert.equal(report.wallets.find(wallet => wallet.address === treasury).roles.length, 4);
  assert.deepEqual(report.sponsoredGas, { amount: '0.00005', count: 1 });
  const grants = await accountingMovements(context, accountingQuery({ kind: 'gasGrants', wallet: funder }), null);
  assert.deepEqual(grants.items.map(row => [row.to, row.amount, row.category]), [[customer, '0.00005', 'gasGrant']]);
  const funding = await accountingMovements(context, accountingQuery({ kind: 'mxnp', tx: firstTx }), null);
  assert.deepEqual(funding.items.map(row => [row.from, row.to, row.amount, row.category]), [
    [factory1, pool1, '100.0', 'seed'], [owner, factory1, '100.0', 'seedFunding'],
  ]);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('unproved funding or recovery cannot become a realized loss or an estimated gain', async () => {
  const unknown = { seed: 100n, recovery: null, recoverable: null, ownedSeed: true, closed: false };
  assert.deepEqual(liquidityResult(unknown), { realized: null, openDownside: null });
  assert.deepEqual(liquidityResult({ ...unknown, ownedSeed: false, closed: true, recovery: 90n }),
    { realized: null, openDownside: null });
  const sql = async () => [];
  const context = await accountingContext({ sql, provider, env, settings: accountingSettings(env) });
  assert.ok(context.warnings.includes('registry_incomplete'));
});

test('market pages preserve the snapshot and expose older pools when the registry exceeds the read budget', async () => {
  const all = Array.from({ length: 43 }, (_, index) => ({
    id: 43 - index, market_id: 43 - index, factory_address: factory1, question: 'Fixture',
    pool_address: '0x' + (100 + index).toString(16).padStart(40, '0'),
  }));
  const sql = async (_, _factories, marketBefore, _sameCursor, limit) =>
    all.filter(row => marketBefore === null || row.id < marketBefore).slice(0, limit);
  const settings = accountingSettings(env);
  const first = await accountingContext({ sql, provider, env, settings });
  assert.equal(first.pools.size, 40);
  assert.equal(first.nextMarketBefore, 4);
  assert.ok(first.warnings.includes('market_page'));
  const secondQuery = accountingQuery({ block: String(block), marketBefore: String(first.nextMarketBefore) });
  const second = await accountingContext({ sql, provider, env, settings, ...secondQuery });
  assert.equal(second.block.number, first.block.number);
  assert.deepEqual([...second.pools.values()].map(row => row.id), [3, 2, 1]);
  assert.equal(second.nextMarketBefore, null);
  assert.ok(second.warnings.includes('market_page'));
});

test('movement pagination deduplicates tracked-to-tracked transfers and preserves the end of the original block window', async () => {
  const logs = Array.from({ length: 25 }, (_, index) =>
    transfer(owner, treasury, 500000, { tx: hash(100 + index), index, blockNumber: block - 1 }));
  const context = { collateral: token, block: { number: block }, pools: new Map(),
    wallets: new Map([[owner, { roles: [] }], [treasury, { roles: [] }]]),
    provider: {
      getTransactionReceipt: async () => ({ status: 1, logs: [] }),
      getLogs: async ({ fromBlock, toBlock }) => logs.filter(log => log.blockNumber >= fromBlock && log.blockNumber <= toBlock),
    },
  };
  const first = await accountingMovements(context, accountingQuery({ kind: 'mxnp' }), null);
  assert.equal(first.items.length, 20);
  assert.ok(first.items.every(item => item.category === 'internal' && item.amount === '0.5'));
  const cursor = Object.fromEntries(Object.entries(first.next).map(([key, value]) => [key, String(value)]));
  const second = await accountingMovements(context, accountingQuery({ kind: 'mxnp', ...cursor }), null);
  assert.equal(first.fromBlock, second.fromBlock);
  assert.equal(second.items.length, 5);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 25);
  assert.equal(second.next.through, second.fromBlock - 1);
  await assert.rejects(accountingMovements(context, accountingQuery({ kind: 'mxnp', wallet: customer }), null), { status: 400 });
});

test('equal fee and payout to the same address remain separate movements', async () => {
  const tx = hash(40);
  const receipt = { status: 1, blockNumber: oldBlock, logs: [
    transfer(pool1, treasury, 2500000, { tx, index: 0 }),
    transfer(pool1, treasury, 2500000, { tx, index: 1 }),
    event(poolMoneyEvents, 'SharesSold(address,bool,uint256,uint256,uint256)', pool1,
      [treasury, true, 10000000, 2500000, 2500000], { tx, index: 2 }),
  ] };
  const context = { collateral: token, block: { number: block },
    pools: new Map([[pool1, { address: pool1, id: 1, version: 'v1', factory: factory1 }]]),
    wallets: new Map([[treasury, { roles: ['feeCollector'] }]]),
    provider: { getTransactionReceipt: async () => receipt } };
  const report = await accountingMovements(context, accountingQuery({ kind: 'mxnp', tx }), null);
  assert.deepEqual(report.items.map(item => item.category), ['sale', 'commission']);
});

test('native history separates value, automatic grants and network fees, including fees on reverted transactions', async () => {
  const context = { block: { number: block }, warnings: [], pools: new Map(), wallets: new Map([[funder, { roles: ['gasFunder'] }]]),
    provider: { getTransactionReceipt: async () => ({ gasUsed: ethers.BigNumber.from(100), effectiveGasPrice: ethers.BigNumber.from(200) }) } };
  const query = accountingQuery({ kind: 'eth', wallet: funder });
  assert.equal((await accountingMovements(context, query, null)).coverage, 'explorerUnconfigured');
  const { explorerKey } = accountingSettings({ ...env, ETHERSCAN_API: 'test-key' });
  const fetcher = async url => {
    assert.equal(url.origin, 'https://api.etherscan.io');
    assert.equal(url.searchParams.get('chainid'), '421614');
    assert.equal(url.searchParams.get('apikey'), 'test-key');
    assert.equal(url.searchParams.get('endblock'), String(block));
    assert.equal(url.searchParams.get('address'), funder);
    const common = { from: funder, to: customer, value: '50000000000000', blockNumber: String(block - 1) };
    return new Response(JSON.stringify({ status: '1', result: [
      { ...common, hash: firstTx, isError: '0' }, { ...common, hash: secondTx, isError: '1' },
    ] }));
  };
  const history = await accountingMovements(context, query, explorerKey, fetcher);
  assert.deepEqual(history.items.map(row => row.category), ['gasFundingTransfer', 'networkFee', 'networkFee']);
  assert.equal(history.gasSpent, '0.00000000000004');
  assert.equal(history.items[0].amount, '0.00005');
  assert.ok(!JSON.stringify(history).includes('test-key'));
});

test('HTTP accounting is GET-only, private, admin-only and restricted to the Sepolia preview', async t => {
  const settings = { ...env, POINTS_SESSION_SECRET: 'accounting-fixture-session', POINTS_ADMIN_USERNAMES: 'operator' };
  const saved = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  async function request(method = 'GET', username = 'operator', query = {}) {
    const res = {
      headers: {}, setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; },
    };
    const headers = username ? { cookie: 'pronos_points_session=' + createSessionToken({ suborgId: 'fixture', username }) } : {};
    await handler({ method, headers, query }, res);
    return res;
  }
  assert.equal((await request('POST')).code, 405);
  assert.equal((await request('GET', null)).code, 401);
  assert.equal((await request('GET', 'customer')).code, 403);
  assert.equal((await request('GET', 'operator', { kind: 'mxnp', wallet: 'unvalidated' })).code, 400);
  process.env.VERCEL_GIT_COMMIT_REF = 'pointbreak';
  const response = await request();
  assert.equal(response.code, 403);
  assert.equal(response.body.error, 'onchain_accounting_disabled');
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
});
