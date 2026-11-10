import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { FEEDS_ARBITRUM_ONE } from './chainlink.js';
import { ensurePointsSchema } from './points-schema.js';
import { ensureProtocolSchema } from './protocol-schema.js';
import { indexReviewedResolution, REVIEW_EVENT_ABI } from './protocol-resolution-review.js';
import { ensureReviewedCreationSchema } from './reviewed-market-creation-schema.js';
import {
  getReviewedCreation, queueReviewedCreation, reviewedCreationConfig, runReviewedCreation,
} from './reviewed-market-creation.js';
import { reviewedMarketRules, sepoliaReviewedRules } from './reviewed-market-rules.js';

const mxnb = '0xf197ffc28c23e0309b5559e7a166f2c6164c80aa';
const factory = '0x0000000000000000000000000000000000000100';
const factoryV2 = '0x0000000000000000000000000000000000000101';
const pool = '0x0000000000000000000000000000000000000200';
const owner = '0x0000000000000000000000000000000000000300';
const resolver = '0x0000000000000000000000000000000000000301';
const reviewer = '0x0000000000000000000000000000000000000302';
const mxnp = '0x0000000000000000000000000000000000000500';
const wallet = new ethers.Wallet('0x' + '1'.repeat(64));
const now = Date.parse('2026-11-08T00:00:00Z');
const cutoff = '2026-11-15T23:59:00.000Z';
const env = {
  ONCHAIN_REVIEWED_CREATION_ENABLED: 'true', ONCHAIN_MAINNET_REVIEW_ENABLED: 'true',
  ONCHAIN_CHAIN_ID: '42161', ONCHAIN_RPC_URL: 'http://never-called',
  ONCHAIN_COLLATERAL_ADDRESS: mxnb, ONCHAIN_MARKET_FACTORY_ADDRESS: factory,
  ONCHAIN_MARKET_FACTORY_V2_ADDRESS: factoryV2, ONCHAIN_REVIEWED_CREATOR_ADDRESS: wallet.address,
  ONCHAIN_REVIEWED_CREATOR_SUBORG_ID: 'test', ONCHAIN_REVIEWED_CREATION_SEED_MXNB: '123.45',
  ONCHAIN_REVIEWED_CREATION_MAX_GAS_ETH: '0.001', ONCHAIN_REVIEWED_CREATION_BROADCAST_ENABLED: 'true',
};
const sepoliaEnv = {
  ...env, ONCHAIN_CHAIN_ID: '421614', CHAIN_ID: '421614', ONCHAIN_COLLATERAL_ADDRESS: mxnp,
  ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', ONCHAIN_SEPOLIA_REVIEW_ENABLED: 'true',
  VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia',
  DATABASE_URL: 'postgres://test:local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb',
  ONCHAIN_REVIEWED_CREATION_MAX_SEED_MXNP: '5000',
};
const crypto = {
  question: '¿BTC cerrará por encima de $75,000 USD el 15/11/2026?',
  category: 'crypto', source: 'chainlink', source_event_id: 'crypto:BTC:2026-11-15:75000',
  outcomes: ['Sí', 'No'], end_time: cutoff, amm_mode: 'unified', resolver_type: 'chainlink_price',
  resolver_config: { ...FEEDS_ARBITRUM_ONE.BTC_USD, threshold: 75000, op: 'gt', yesOutcome: 0 },
  source_data: { asset: 'BTC', strike: 75000, feed: FEEDS_ARBITRUM_ONE.BTC_USD.feedAddress },
};
const soccer = {
  question: 'Club A vs Club B', category: 'deportes', source: 'espn-soccer', source_event_id: 'mex.1:123',
  outcomes: ['Club A', 'Empate', 'Club B'], amm_mode: 'unified', resolver_type: 'sports_api',
  start_time: cutoff, end_time: '2026-11-16T01:59:00.000Z',
  resolver_config: { source: 'espn', leaguePath: 'soccer/mex.1', eventId: '123', shape: 'draw3' },
  source_data: { eventId: '123', leagueCode: 'mex.1', kickoffUtc: cutoff, home: { id: '1', name: 'Club A' },
    away: { id: '2', name: 'Club B' } },
};

test('rules bind the exact question, ordered outcomes, source and cutoff', () => {
  const price = reviewedMarketRules(crypto, now);
  const match = reviewedMarketRules(soccer, now);
  assert.equal(price.version, 'v1');
  assert.equal(match.version, 'v2');
  assert.equal(match.cutoff, soccer.start_time);
  assert.equal(match.rulesHash, ethers.utils.id(match.content));
  assert.match(match.source, /soccer\/mex\.1\/summary\?event=123$/);
  assert.match(price.content, /estrictamente mayor que 75000 USD/);
  for (const row of [
    { ...crypto, question: crypto.question.replace('75,000', '80,000') },
    { ...crypto, source: 'unsupported' },
    { ...soccer, outcomes: soccer.outcomes.toReversed() },
    { ...soccer, start_time: soccer.end_time },
    { ...soccer, is_test_market: true },
  ]) assert.throws(() => reviewedMarketRules(row, now), { message: 'reviewed_rules_incomplete' });
  assert.throws(() => reviewedMarketRules(soccer, Date.parse(cutoff)), { message: 'reviewed_rules_incomplete' });
});

test('broadcast and mainnet permissions are independently gated', () => {
  assert.equal(reviewedCreationConfig({ ...env, ONCHAIN_REVIEWED_CREATION_BROADCAST_ENABLED: 'false' }).broadcast, false);
  for (const flags of [{ ONCHAIN_CHAIN_ID: '421614' }, { PROTOCOL_CHAIN_ID: '421614' },
    { ONCHAIN_MAINNET_REVIEW_ENABLED: 'false' }, { ONCHAIN_REVIEWED_CREATION_ENABLED: 'false' }]) {
    assert.throws(() => reviewedCreationConfig({ ...env, ...flags }), { message: 'reviewed_creation_disabled' });
  }
  assert.throws(() => reviewedCreationConfig({ ...env, ONCHAIN_DEPLOYER_ADDRESS: wallet.address }),
    { message: 'reviewed_creation_not_configured' });
  assert.throws(() => reviewedCreationConfig({ ...env, ONCHAIN_COLLATERAL_ADDRESS: owner }),
    { message: 'reviewed_creation_not_configured' });
});

test('reviewed creation binds Sepolia to the isolated preview and existing collateral', () => {
  assert.equal(reviewedCreationConfig(sepoliaEnv).collateral, mxnp);
  for (const flags of [{ CHAIN_ID: '' }, { PROTOCOL_CHAIN_ID: '42161' }, { VERCEL_ENV: 'production' },
    { DATABASE_READ_URL: 'postgres://localhost/wrong' }]) {
    assert.throws(() => reviewedCreationConfig({ ...sepoliaEnv, ...flags }), { message: 'reviewed_creation_disabled' });
  }
  for (const flags of [{ ONCHAIN_COLLATERAL_ADDRESS: mxnb }, { ONCHAIN_REVIEWED_CREATION_MAX_SEED_MXNP: '' },
    { ONCHAIN_GAS_FUNDER_ADDRESS: wallet.address }]) {
    assert.throws(() => reviewedCreationConfig({ ...sepoliaEnv, ...flags }), { message: 'reviewed_creation_not_configured' });
  }
});

test('approval publishes exact rules once and links only the finalized indexed pool', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const sql = async (parts, ...params) =>
    (await db.query(parts.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, ''), params)).rows;
  sql.query = async text => {
    // The legacy Points list index assumes the archive column is already deployed.
    if (text.startsWith('CREATE INDEX IF NOT EXISTS idx_points_markets_tournament_featured_active_end')) {
      await db.exec('ALTER TABLE points_markets ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ');
    }
    return (await db.query(text)).rows;
  };
  const transaction = cb => db.transaction(cb);
  await ensurePointsSchema(sql);
  await ensureProtocolSchema(sql);
  await ensureReviewedCreationSchema(transaction);
  const indexedFactories = [{ version: 'v1', address: factory }, { version: 'v2', address: factoryV2 }];
  const config = reviewedCreationConfig(env);
  async function addPending(row) {
    const [{ id }] = await sql`
      INSERT INTO points_pending_markets
        (question, category, source, source_event_id, outcomes, start_time, end_time,
          resolver_type, resolver_config, source_data)
      VALUES (${row.question}, ${row.category}, ${row.source}, ${row.source_event_id},
        ${JSON.stringify(row.outcomes)}::jsonb, ${row.start_time || null}, ${row.end_time},
        ${row.resolver_type}, ${JSON.stringify(row.resolver_config)}::jsonb, ${JSON.stringify(row.source_data)}::jsonb)
      RETURNING id`;
    return id;
  }
  const id = await addPending(crypto);
  const other = await addPending(soccer);
  const approve = pendingId => queueReviewedCreation({
    pendingId, reviewer: 'admin', transaction, config, indexedFactories, now,
  });
  const [created, duplicate] = await Promise.all([approve(id), approve(id)]);
  assert.deepEqual(duplicate, created);
  assert.equal(created.status, 'queued');
  const [document] = await sql`SELECT content FROM protocol_resolution_documents WHERE hash = ${created.rulesHash}`;
  assert.equal(ethers.utils.id(document.content), created.rulesHash);
  assert.equal((await sql`SELECT status FROM points_pending_markets WHERE id = ${id}`)[0].status, 'creation_pending');
  assert.equal((await sql`SELECT id FROM points_markets`).length, 0);

  const commonAbi = [
    'function requiresResolutionReview() returns (bool)',
    ...['collateral', 'marketCreator', 'owner', 'resolver', 'resolutionReviewer'].map(name => `function ${name}() returns (address)`),
    REVIEW_EVENT_ABI[0],
  ];
  const creationMethod = 'function createReviewedMarket((string,string,uint256,string,uint256,bytes32)';
  const createdEvent = 'event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime';
  const iface = new ethers.utils.Interface([...commonAbi, creationMethod + ') returns (uint256)', createdEvent + ')']);
  const ifaceV2 = new ethers.utils.Interface([...commonAbi, creationMethod + ',string[]) returns (uint256)',
    createdEvent + ',string resolutionSource,string[] outcomes)']);
  let active = created;
  let signatures = 0;
  let head = 9;
  let receipt = null;
  let network = 421614;
  const broadcasts = [];
  const provider = {
    _isProvider: true,
    getNetwork: async () => ({ chainId: network }),
    resolveName: async value => value,
    getTransactionCount: async () => 5,
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => null,
    estimateGas: async () => ethers.BigNumber.from(500000),
    getGasPrice: async () => ethers.BigNumber.from(100000000),
    getBalance: async () => ethers.utils.parseEther('1'),
    call: async transactionRequest => {
      const tx = await ethers.utils.resolveProperties(transactionRequest);
      const isV2 = tx.to.toLowerCase() === factoryV2;
      const abi = isV2 ? ifaceV2 : iface;
      const method = abi.getFunction(tx.data.slice(0, 10)).name;
      if (method === 'createReviewedMarket') {
        const [input, outcomes] = abi.decodeFunctionData(method, tx.data);
        assert.equal(input[4].toString(), '123450000');
        assert.equal(input[5], active.rulesHash);
        if (network === 421614) assert.equal(input[3], `/api/points/resolution-review?document=${active.rulesHash}`);
        if (isV2) assert.deepEqual([...outcomes], soccer.outcomes);
      }
      const value = { requiresResolutionReview: true, collateral: network === 421614 ? mxnp : mxnb, marketCreator: wallet.address,
        owner, resolver, resolutionReviewer: reviewer, createReviewedMarket: 7 };
      return abi.encodeFunctionResult(method, [value[method]]);
    },
    send: async (method, [raw]) => {
      if (method === 'eth_getBlockByNumber') return { number: ethers.utils.hexValue(head) };
      assert.equal(method, 'eth_sendRawTransaction');
      const stored = await getReviewedCreation(active.id, transaction);
      assert.equal(stored.status, 'signed');
      broadcasts.push(raw);
      if (broadcasts.length === 1) throw new Error('response lost');
      return ethers.utils.keccak256(raw);
    },
  };
  const sign = async ({ unsignedSerialized }) => {
    signatures++;
    const { to, data, chainId, nonce, gasLimit, gasPrice } = ethers.utils.parseTransaction(unsignedSerialized);
    return wallet.signTransaction({ to, data, chainId, nonce, gasLimit, gasPrice });
  };
  const run = (override = {}) => runReviewedCreation({
    config, indexedFactories, transaction, clock: () => now, provider, sign, ...override,
  });
  assert.equal((await run({ config: { ...config, broadcast: false } })).status, 'broadcast_paused');
  assert.equal((await run()).error, 'reviewed_creation_wrong_chain');
  assert.equal(signatures, 0);
  network = 42161;
  assert.equal((await run({ config: { ...config, maxGasCost: ethers.BigNumber.from(1) } })).error,
    'reviewed_creation_gas_cap');
  assert.equal(signatures, 0);
  const uncertain = await run();
  assert.equal(uncertain.status, 'broadcast_unconfirmed');
  assert.equal((await run()).transactionHash, uncertain.transactionHash);
  assert.equal(broadcasts[0], broadcasts[1]);
  assert.equal(signatures, 1);

  const hash = uncertain.transactionHash;
  const time = Date.parse(cutoff) / 1000;
  const commitment = iface.encodeEventLog('ResolutionRulesCommitted', [7, created.rulesHash]);
  receipt = { to: factory, from: wallet.address, transactionHash: hash, status: 1, blockNumber: 10,
    logs: [
      { address: factory, ...iface.encodeEventLog('MarketCreated', [7, pool, crypto.question, crypto.category, time]) },
      { address: factory, ...commitment },
    ] };
  assert.equal((await run()).status, 'awaiting_finality');
  head = 10;
  assert.equal((await run()).status, 'awaiting_index');
  assert.equal((await sql`SELECT id FROM points_markets`).length, 0);
  await sql`
    INSERT INTO protocol_markets
      (chain_id, factory_address, market_id, pool_address, question, category, end_time, outcomes, tx_hash)
    VALUES (42161, ${factory}, 7, ${pool}, ${crypto.question}, ${crypto.category}, ${cutoff}, '["Sí","No"]', ${hash})`;
  await indexReviewedResolution(sql, 42161, factory, { kind: 'ResolutionRulesCommitted', event: {
    args: iface.parseLog(commitment).args, transactionHash: hash, blockNumber: 10, logIndex: 1,
  } });
  assert.equal((await run()).status, 'listed');
  assert.equal((await run()).status, 'idle');
  const [listed] = await sql`SELECT mode, chain_id, chain_market_id, chain_address, seed_liquidity FROM points_markets`;
  assert.equal(listed.mode, 'onchain');
  assert.equal(listed.chain_id, 42161);
  assert.equal(Number(listed.chain_market_id), 7);
  assert.equal(listed.chain_address, pool);
  assert.equal(Number(listed.seed_liquidity), 123.45);
  assert.equal((await approve(id)).status, 'listed');
  active = await approve(other);
  receipt = null;
  const multi = await run();
  assert.equal(multi.status, 'broadcast');
  const rules = reviewedMarketRules(soccer, now);
  receipt = { to: factoryV2, from: wallet.address, transactionHash: multi.transactionHash, status: 1, blockNumber: 10,
    logs: [
      { address: factoryV2, ...ifaceV2.encodeEventLog('MarketCreated', [
        7, pool, soccer.question, soccer.category, time, rules.source, soccer.outcomes,
      ]) },
      { address: factoryV2, ...ifaceV2.encodeEventLog('ResolutionRulesCommitted', [7, rules.rulesHash]) },
    ] };
  await sql`
    INSERT INTO protocol_markets
      (chain_id, factory_address, market_id, pool_address, question, category, end_time, outcomes, tx_hash,
       protocol_version, resolution_review)
    VALUES (42161, ${factoryV2}, 7, ${pool}, ${soccer.question}, ${soccer.category}, ${cutoff},
      ${JSON.stringify(soccer.outcomes)}::jsonb, ${multi.transactionHash}, 'v2', '{"rulesHash":"wrong"}')`;
  assert.equal((await run()).error, 'reviewed_index_mismatch');
  assert.equal((await sql`SELECT id FROM points_markets`).length, 1);
  const late = await addPending({ ...soccer, source_event_id: 'mex.1:456',
    resolver_config: { ...soccer.resolver_config, eventId: '456' }, source_data: { ...soccer.source_data, eventId: '456' } });
  assert.equal((await approve(late)).status, 'queued');
  assert.equal((await run({ clock: () => Date.parse(cutoff) })).status, 'expired');

  network = 421614;
  const previewConfig = reviewedCreationConfig(sepoliaEnv);
  const reviewedFactories = indexedFactories.map(item => ({ ...item, reviewStart: 1 }));
  const verifyRouter = async () => ({ factories: [factory, factoryV2] });
  const priorSignatures = signatures;
  for (const [version, abi, address, eventId, outcomes] of [
    ['v1', iface, factory, 'mex.1:777', ['Club A', 'Club B']],
    ['v2', ifaceV2, factoryV2, 'mex.1:888', soccer.outcomes],
  ]) {
    const proposal = { ...soccer, source_event_id: eventId, outcomes };
    const pendingId = await addPending(proposal);
    const criteria = 'Gana el equipo que marque más goles en tiempo reglamentario.';
    const sourceUrl = `https://example.com/matches/${eventId.split(':')[1]}`;
    const prepare = (_client, row) => ({
      rules: sepoliaReviewedRules({ row, outcomes, endDate: new Date(cutoff), criteria, sourceUrl }, now),
      seed: 123.45, sourceData: { resolutionCriteria: criteria }, resolverConfig: { ...row.resolver_config, criteria },
      sourceEventId: `${eventId}:approved`, categoryTagsJson: '[]', geoTagsJson: '[]', topicTagsJson: '[]',
    });
    const options = { pendingId, reviewer: 'admin', transaction, config: previewConfig, indexedFactories: reviewedFactories, now };
    await assert.rejects(queueReviewedCreation({ ...options, config: { ...previewConfig, seed: ethers.BigNumber.from(1) }, prepare }),
      { message: 'reviewed_creation_seed_cap' });
    await assert.rejects(queueReviewedCreation({ ...options, indexedFactories, prepare }), { message: 'reviewed_factory_not_indexed' });
    active = await queueReviewedCreation({ ...options, prepare });
    const rulesPath = `/api/points/resolution-review?document=${active.rulesHash}`;
    receipt = null;
    const advance = (verify = verifyRouter) => run({ config: previewConfig, pendingId, indexedFactories: reviewedFactories, verifyRouter: verify });
    const blocked = await advance(async () => null);
    assert.equal(blocked.error, 'reviewed_trading_router_unverified');
    const sent = await advance();
    assert.equal(sent.status, 'broadcast', JSON.stringify(sent));
    const contractId = 0;
    const marketFields = [contractId, pool, proposal.question, proposal.category, time];
    const rulesEvent = abi.encodeEventLog('ResolutionRulesCommitted', [contractId, active.rulesHash]);
    receipt = { to: address, from: wallet.address, transactionHash: sent.transactionHash, status: 1, blockNumber: 10,
      logs: [
        { address, ...abi.encodeEventLog('MarketCreated', version === 'v2' ? [...marketFields, rulesPath, outcomes] : marketFields) },
        { address, ...rulesEvent },
      ] };
    assert.equal((await advance()).status, 'awaiting_index');
    await sql`
      INSERT INTO protocol_markets
        (chain_id, factory_address, market_id, pool_address, question, category, end_time, outcomes, tx_hash, protocol_version)
      VALUES (421614, ${address}, ${contractId}, ${pool}, ${proposal.question}, ${proposal.category}, ${cutoff},
        ${JSON.stringify(version === 'v1' ? ['Sí', 'No'] : outcomes)}::jsonb, ${sent.transactionHash}, ${version})`;
    await indexReviewedResolution(sql, 421614, address, { kind: 'ResolutionRulesCommitted', event: {
      args: abi.parseLog(rulesEvent).args, transactionHash: sent.transactionHash, blockNumber: 10, logIndex: 1,
    } });
    assert.equal((await advance()).status, 'listed');
    const [market] = await sql`
      SELECT chain_market_id, outcomes, resolution_src, resolver_type, resolver_config, seed_liquidity
      FROM points_markets WHERE chain_id = 421614 AND source_event_id = ${`${eventId}:approved`}`;
    assert.equal(Number(market.chain_market_id), 0);
    assert.deepEqual(market.outcomes, outcomes);
    assert.equal(market.resolution_src, rulesPath);
    assert.equal(market.resolver_type, proposal.resolver_type);
    assert.equal(market.resolver_config.criteria, criteria);
    assert.equal(Number(market.seed_liquidity), 123.45);
    assert.equal((await advance()).status, 'idle');
  }
  assert.equal(signatures, priorSignatures + 2);
});
