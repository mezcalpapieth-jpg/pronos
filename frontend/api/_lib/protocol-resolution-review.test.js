import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ethers } from 'ethers';
import { ensureProtocolSchema } from './protocol-schema.js';
import { indexReviewedResolution, isReviewedFactory, REVIEW_EVENT_ABI } from './protocol-resolution-review.js';
import { createResolutionReviewHandler } from '../points/resolution-review.js';

const factory = '0x0000000000000000000000000000000000000042';
const wallet = '0x0000000000000000000000000000000000000001';
const hash = text => ethers.utils.id(text);
const rules = 'Resolve by the official source.\n';
const evidence = 'First official source snapshot.\n';
const correctedEvidence = 'Corrected official source snapshot.\n';
const proposal = hash('first');
const corrected = hash('second');
const deadline = 1800000000;
const abi = new ethers.utils.Interface([...REVIEW_EVENT_ABI,
  'event ResolutionDisputeOpened(uint256 indexed marketId)']);

test('review capability is detected on both Arbitrum chains and RPC failures propagate', async () => {
  const rpc = { call: async () => ethers.utils.defaultAbiCoder.encode(['bool'], [true]) };
  assert.equal(await isReviewedFactory(rpc, 42161, factory), true);
  assert.equal(await isReviewedFactory(rpc, 421614, factory), true);
  assert.equal(await isReviewedFactory({}, 84532, factory), false);
  assert.equal(await isReviewedFactory({ call: async () => '0x' }, 421614, factory), false);
  const legacy = { call: async () => ethers.utils.defaultAbiCoder.encode(['bool'], [false]) };
  assert.equal(await isReviewedFactory(legacy, 421614, factory), false);
  const error = new Error('timeout');
  await assert.rejects(isReviewedFactory({ call: async () => { throw error; } }, 42161, factory), error);
});

test('indexed reviews, published documents and Points objections follow the exact proposal', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const sql = async (parts, ...params) =>
    (await db.query(parts.reduce((out, part, i) => out + (i ? `$${i}` : '') + part, ''), params)).rows;
  sql.query = async text => (await db.query(text)).rows;
  await ensureProtocolSchema(sql);
  await db.exec(`
    CREATE TABLE points_markets (id integer PRIMARY KEY, question text, mode text, chain_id int,
      chain_address text, chain_market_id text, outcomes jsonb);
    INSERT INTO protocol_markets (chain_id, factory_address, pool_address, market_id, question, end_time,
      outcomes, protocol_version)
      VALUES (42161, '${factory}', 'pool', 0, 'Fixture?', NOW(), '["Yes","No"]', 'v1'),
             (421614, '${factory}', 'pool', 0, 'Sepolia?', NOW(), '["Yes","No"]', 'v1');
    INSERT INTO points_markets VALUES (123,'Fixture?','onchain',42161,'POOL','0','["Yes","No"]'),
      (124,'Sepolia?','onchain',421614,'pool','0','["Lakers","Hawks"]');
  `);

  const auth = (kind, status) => (req, res) => {
    if (req.actor === kind) return { sub: `private-${kind}` };
    res.status(status).json({ error: 'denied' });
    return null;
  };
  const options = { sqlFor: () => sql, limit: () => false,
    adminFor: auth('admin', 403), sessionFor: auth('user', 401) };
  const handler = createResolutionReviewHandler({ ...options, env: { ONCHAIN_MAINNET_REVIEW_ENABLED: 'true' } });
  async function request({ method = 'GET', query = { marketId: '123' }, body, actor, route = handler } = {}) {
    const result = {};
    const res = {
      setHeader: () => {},
      status: code => { result.status = code; return res; },
      json: value => { result.body = value; return res; },
      send: value => { result.body = value; return res; },
    };
    await route({ method, query, body, actor, headers: {} }, res);
    return result;
  }
  const market = async () => (await sql`SELECT status, outcome FROM protocol_markets WHERE chain_id=42161`)[0];
  const get = async () => (await request()).body.review;
  function log(kind, values, blockNumber, logIndex = 0) {
    const encoded = abi.encodeEventLog(abi.getEvent(kind), [0, ...values]);
    return { kind, event: {
      args: abi.parseLog(encoded).args, blockNumber, logIndex, transactionHash: hash(`tx:${blockNumber}`),
    } };
  }
  const apply = entry => indexReviewedResolution(sql, 42161, factory, entry);

  const rulesEvent = log('ResolutionRulesCommitted', [hash(rules)], 1);
  const first = log('ResolutionProposed', [proposal, wallet, 2, hash(evidence), 1, deadline], 2);
  const firstApproval = log('ResolutionApproved', [proposal, wallet], 2, 1);
  const dispute = log('ResolutionDisputeOpened', [], 3);
  const revision = log('ResolutionProposed', [corrected, wallet, 1, hash(correctedEvidence), 2, deadline + 90000], 4);
  const flagged = log('ResolutionFlagged', [corrected, wallet, hash('chain objection')], 5);
  const approval = log('ResolutionApproved', [corrected, wallet], 6);
  const finalized = log('ResolutionReviewFinalized', [corrected], 7);
  const object = (proposalId, detail) => request({ method: 'POST', actor: 'user',
    body: { action: 'object', marketId: 123, proposalId, detail } });
  const publish = content => request({ method: 'POST', actor: 'admin',
    body: { action: 'publish', marketId: 123, content } });

  assert.equal((await request({ route: createResolutionReviewHandler({ ...options, env: {} }) })).status, 404);
  await assert.rejects(apply(first), /Missing resolution rules/);
  await apply(rulesEvent);
  assert.equal((await get()).state, 'open');
  assert.equal((await request({ query: { marketId: '124' } })).status, 404);
  assert.equal((await publish(rules.trim())).status, 409);
  assert.equal((await publish(rules)).status, 200);
  assert.equal((await request({ query: { document: hash(rules) } })).body, rules);

  await apply(first);
  await apply(firstApproval);
  assert.deepEqual(await market(), { status: 'under_review', outcome: null });
  assert.equal((await get()).outcome, 1);
  assert.equal((await request({ method: 'POST', body: { action: 'object' } })).status, 401);
  const report = await object(proposal, 'Wrong result');
  assert.equal(report.status, 200);
  assert.deepEqual(await object(proposal, 'Wrong result'), report);
  assert.equal((await object(proposal, 'Different result')).status, 409);
  await apply(dispute);
  assert.equal((await get()).state, 'disputed');
  assert.equal((await get()).approved, false);
  await apply(revision);
  assert.equal((await get()).reviewEndsAt, new Date((deadline + 90000) * 1000).toISOString());
  assert.equal((await object(proposal, 'Wrong result')).status, 200); // Lost-response retry.
  assert.equal((await object(hash('another proposal'), 'Wrong result')).body.error, 'proposal_changed');
  assert.equal((await publish(correctedEvidence)).status, 200);
  assert.equal((await get()).evidenceDocument, hash(correctedEvidence));

  await apply(flagged);
  await apply(flagged);
  assert.equal((await request({ query: { queue: '1' }, actor: 'user' })).status, 403);
  const inbox = (await request({ query: { queue: '1' }, actor: 'admin' })).body;
  assert.equal(inbox.markets[0].review.proposalId, corrected);
  assert.deepEqual(inbox.objections.map(row => [row.source, row.current]), [['chain', true], ['points', false]]);
  assert.ok(!JSON.stringify(inbox).includes('private-user'));
  await assert.rejects(apply(finalized), /without indexed approval/);
  await apply(approval);
  assert.deepEqual(await market(), { status: 'under_review', outcome: null });
  await apply(finalized);
  assert.deepEqual(await market(), { status: 'resolved', outcome: 1 });
  assert.equal((await get()).outcome, 0);
  assert.equal((await get()).state, 'finalized');
  assert.equal((await object(corrected, 'After finalization')).status, 409);

  for (const entry of [rulesEvent, first, firstApproval, dispute, revision, flagged, approval, finalized]) await apply(entry);
  assert.deepEqual(await market(), { status: 'resolved', outcome: 1 });
  assert.equal((await sql`SELECT count(*)::int AS count FROM protocol_resolution_objections`)[0].count, 2);

  const sepoliaEnv = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'onchain-sepolia',
    ONCHAIN_CHAIN_ID: '421614', ONCHAIN_PREVIEW_APPROVALS_ENABLED: 'true', ONCHAIN_SEPOLIA_REVIEW_ENABLED: 'true',
    DATABASE_URL: 'postgres://test:local@ep-delicate-glitter-amp7yrkv.c-5.us-east-1.aws.neon.tech/neondb' };
  const route = createResolutionReviewHandler({ ...options, env: sepoliaEnv,
    providerFor: () => ({}), prepare: async ({ market: row, action, proposalId }) => {
      assert.equal(action, 'approve');
      assert.equal(row.review.proposalId, proposalId);
      return { chainId: 421614 };
    } });
  const applySepolia = entry => indexReviewedResolution(sql, 421614, factory, entry);
  await applySepolia(rulesEvent);
  await applySepolia(first);
  const query = { marketId: '124' };
  const sepolia = (await request({ route, query })).body.review;
  assert.deepEqual([sepolia.chainId, sepolia.state, sepolia.outcomes[sepolia.outcome]], [421614, 'under_review', 'Hawks']);
  assert.equal((await request({ route, query: { marketId: '123' } })).status, 404);
  const prepareRequest = { route, method: 'POST', body: { action: 'prepare', operation: 'approve', marketId: 124, proposalId: proposal } };
  assert.equal((await request({ ...prepareRequest, actor: 'user' })).status, 403);
  assert.equal((await request({ ...prepareRequest, actor: 'admin' })).body.transaction.chainId, 421614);
  const sepoliaMarket = async () => (await sql`SELECT status, outcome FROM protocol_markets WHERE chain_id=421614`)[0];
  await applySepolia(firstApproval);
  assert.deepEqual(await sepoliaMarket(), { status: 'under_review', outcome: null });
  await applySepolia(log('ResolutionReviewFinalized', [proposal], 3));
  assert.deepEqual(await sepoliaMarket(), { status: 'resolved', outcome: 2 });
});
