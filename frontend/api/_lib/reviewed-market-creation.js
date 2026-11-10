import { ethers } from 'ethers';
import { withTransaction } from './db-tx.js';
import { simulateContractCall } from './onchain-simulation.js';
import { REVIEW_EVENT_ABI, isReviewedFactory } from './protocol-resolution-review.js';
import { REVIEWED_CHAIN_ID, REVIEWED_RULES_PATH, reviewedCreationEnabled, reviewedCreationError } from './reviewed-market-settings.js';
import { reviewedMarketRules } from './reviewed-market-rules.js';
import { verifyTradingRouter } from './trading-router.js';

const MXNB = '0xf197ffc28c23e0309b5559e7a166f2c6164c80aa';
const chainFor = spec => spec.chainId ?? REVIEWED_CHAIN_ID;
const isIndexedFactory = (chain, factories, version, address) => factories.some(item =>
  item.version === version && item.address === address && (chain === REVIEWED_CHAIN_ID || item.reviewStart > 0));
const signLock = 8214;
const tuple = '(string question,string category,uint256 endTime,string resolutionSource,uint256 seedAmount,bytes32 rulesHash)';
const factoryInterface = version => new ethers.utils.Interface([
  `function createReviewedMarket(${tuple}${version === 'v2' ? ', string[] outcomes' : ''}) returns (uint256)`,
  ...['collateral', 'marketCreator', 'owner', 'resolver', 'resolutionReviewer'].map(name => `function ${name}() view returns (address)`),
  `event MarketCreated(uint256 indexed marketId,address pool,string question,string category,uint256 endTime${version === 'v2' ? ',string resolutionSource,string[] outcomes' : ''})`,
  REVIEW_EVENT_ABI[0],
]);

function address(value) {
  return ethers.utils.isAddress(value || '') && value.toLowerCase() !== ethers.constants.AddressZero
    ? value.toLowerCase() : null;
}

function positiveUnits(value, decimals) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  try {
    const units = ethers.utils.parseUnits(value, decimals);
    return units.gt(0) && units.lte(ethers.constants.MaxUint256) ? units : null;
  } catch {
    return null;
  }
}

export function reviewedCreationConfig(env = process.env) {
  if (!reviewedCreationEnabled(env)) {
    throw reviewedCreationError('reviewed_creation_disabled', 'Reviewed creation requires an enabled reviewed runtime.', 403);
  }
  const chainId = Number(env.ONCHAIN_CHAIN_ID);
  const sepolia = chainId !== REVIEWED_CHAIN_ID;
  const collateral = address(env.ONCHAIN_COLLATERAL_ADDRESS);
  const creator = address(env.ONCHAIN_REVIEWED_CREATOR_ADDRESS);
  const seed = positiveUnits(sepolia ? env.ONCHAIN_REVIEWED_CREATION_MAX_SEED_MXNP : env.ONCHAIN_REVIEWED_CREATION_SEED_MXNB, 6);
  const maxGasCost = positiveUnits(env.ONCHAIN_REVIEWED_CREATION_MAX_GAS_ETH, 18);
  const suborgId = env.ONCHAIN_REVIEWED_CREATOR_SUBORG_ID;
  const rpcUrl = env.ONCHAIN_RPC_URL;
  if (!creator || !seed || seed.gte('100000000000000000000') || !maxGasCost || !suborgId || !rpcUrl
    || !collateral || (sepolia ? collateral === MXNB : collateral !== MXNB)
    || [env.ONCHAIN_DEPLOYER_ADDRESS, env.ONCHAIN_RESOLVER_ADDRESS, env.ONCHAIN_OWNER_ADDRESS,
      env.ONCHAIN_GAS_FUNDER_ADDRESS].some(value => creator === address(value))) {
    throw reviewedCreationError('reviewed_creation_not_configured',
      'Configure the dedicated creator, collateral, seed limit and gas cap.', 503);
  }
  return {
    chainId, collateral, creator, seed, maxGasCost, suborgId, rpcUrl,
    factories: {
      v1: address(env.ONCHAIN_MARKET_FACTORY_ADDRESS),
      v2: address(env.ONCHAIN_MARKET_FACTORY_V2_ADDRESS),
    },
    broadcast: env.ONCHAIN_REVIEWED_CREATION_BROADCAST_ENABLED === 'true',
  };
}

function creationView(job) {
  return {
    id: job.pending_id,
    status: job.status,
    rulesHash: job.rules_hash,
    transactionHash: job.tx_hash,
    marketId: job.market_id,
    lastError: job.last_error,
  };
}

async function loadCreation(client, pendingId) {
  const { rows } = await client.query(
    'SELECT * FROM protocol_reviewed_market_creations WHERE pending_id = $1', [pendingId],
  );
  return rows[0];
}

export async function getReviewedCreation(pendingId, transaction = withTransaction, chainId) {
  return transaction(async client => {
    const job = await loadCreation(client, pendingId);
    if (!job || (chainId && chainFor(job.spec) !== chainId)) throw reviewedCreationError('reviewed_creation_not_found', 'No reviewed creation for this pending market.', 404);
    return creationView(job);
  });
}

export async function queueReviewedCreation({
  pendingId, reviewer, note, config, indexedFactories, transaction = withTransaction, now = Date.now(), prepare,
}) {
  return transaction(async client => {
    const { rows: [row] } = await client.query(
      'SELECT * FROM points_pending_markets WHERE id = $1 FOR UPDATE', [pendingId],
    );
    if (!row) throw reviewedCreationError('pending_not_found', 'No pending market with this ID.', 404);
    const existing = await loadCreation(client, pendingId);
    if (existing) {
      if (chainFor(existing.spec) !== config.chainId) throw reviewedCreationError('reviewed_creation_wrong_chain');
      return creationView(existing);
    }
    if (row.status !== 'pending' || (row.approved_market_id && !prepare)) {
      throw reviewedCreationError('already_reviewed', 'Use a fresh pending market for reviewed creation.');
    }
    const draft = prepare ? await prepare(client, row, now) : null;
    const sourceEventId = draft?.sourceEventId ?? row.source_event_id;
    const duplicate = await client.query(
      'SELECT id FROM points_markets WHERE source = $1 AND source_event_id = $2 LIMIT 1',
      [row.source, sourceEventId],
    );
    if (duplicate.rows.length) {
      throw reviewedCreationError('reviewed_market_exists', 'A market is already listed for this pending event.');
    }
    const rules = draft?.rules ?? reviewedMarketRules(row, now);
    const seed = draft ? positiveUnits(String(draft.seed), 6) : config.seed;
    if (!seed || seed.gt(config.seed)) throw reviewedCreationError('reviewed_creation_seed_cap',
      'La liquidez inicial supera el límite de MXNP configurado.');
    const factory = config.factories[rules.version];
    if (!factory || !isIndexedFactory(config.chainId, indexedFactories, rules.version, factory)) {
      throw reviewedCreationError('reviewed_factory_not_indexed', 'Configure the reviewed factory in the runtime and indexer.', 503);
    }
    const spec = {
      chainId: config.chainId,
      collateral: config.collateral,
      version: rules.version,
      factory,
      creator: config.creator,
      seed: seed.toString(),
      cutoff: rules.cutoff,
      resolutionSource: draft ? REVIEWED_RULES_PATH + rules.rulesHash : rules.source,
      question: row.question,
      category: row.category,
      outcomes: row.outcomes,
      ...(draft ? { sourceEventId, resolverConfig: draft.resolverConfig, resolverType: row.resolver_type } : {}),
    };
    await client.query(`
      INSERT INTO protocol_resolution_documents (hash, content) VALUES ($1, $2)
      ON CONFLICT (hash) DO NOTHING
    `, [rules.rulesHash, rules.content]);
    const { rows: [document] } = await client.query(
      'SELECT content FROM protocol_resolution_documents WHERE hash = $1', [rules.rulesHash],
    );
    if (document?.content !== rules.content) throw new Error('reviewed_rules_document_conflict');
    const { rows: [job] } = await client.query(`
      INSERT INTO protocol_reviewed_market_creations (pending_id, rules_hash, spec)
      VALUES ($1, $2, $3::jsonb) RETURNING *
    `, [pendingId, rules.rulesHash, JSON.stringify(spec)]);
    await client.query(`
      UPDATE points_pending_markets SET status = 'creation_pending', reviewer = $2,
        admin_note = $3, reviewed_at = NOW() WHERE id = $1
    `, [pendingId, reviewer, note || null]);
    if (draft) {
      await client.query(`
        UPDATE points_pending_markets SET source_data = $2::jsonb, resolver_config = $3::jsonb,
          category_tags = $4::jsonb, geo_tags = $5::jsonb, topic_tags = $6::jsonb
        WHERE id = $1
      `, [pendingId, JSON.stringify(draft.sourceData), JSON.stringify(draft.resolverConfig),
        draft.categoryTagsJson, draft.geoTagsJson, draft.topicTagsJson]);
    }
    return creationView(job);
  });
}

function createCall(job, iface) {
  const s = job.spec;
  const input = [s.question, s.category, Date.parse(s.cutoff) / 1000, s.resolutionSource, s.seed, job.rules_hash];
  return { to: s.factory, from: s.creator, data: iface.encodeFunctionData('createReviewedMarket',
    s.version === 'v2' ? [input, s.outcomes] : [input]) };
}

async function signCreation(job, provider, config, sign, clock) {
  const { spec } = job;
  const iface = factoryInterface(spec.version);
  const factory = new ethers.Contract(spec.factory, iface, provider);
  const [reviewed, collateral, creator, owner, resolver, reviewer, latest, pending] = await Promise.all([
    isReviewedFactory(provider, config.chainId, spec.factory),
    factory.collateral(), factory.marketCreator(), factory.owner(), factory.resolver(), factory.resolutionReviewer(),
    provider.getTransactionCount(spec.creator, 'latest'),
    provider.getTransactionCount(spec.creator, 'pending'),
  ]);
  if (!reviewed || address(collateral) !== config.collateral || address(creator) !== spec.creator
    || [owner, resolver, reviewer].some(value => !address(value) || address(value) === spec.creator)
    || new Set([owner, resolver, reviewer].map(address)).size !== 3) {
    throw reviewedCreationError('reviewed_factory_roles_mismatch');
  }
  if (pending !== latest) throw reviewedCreationError('reviewed_creator_nonce_busy');

  // Simulation includes the factory's transferFrom and pool initialization.
  // The creator's allowance and collateral must already be in place.
  const call = createCall(job, iface);
  await simulateContractCall(provider, call, iface, 'createReviewedMarket');
  const [estimate, gasPrice, balance] = await Promise.all([
    provider.estimateGas(call), provider.getGasPrice(), provider.getBalance(spec.creator),
  ]);
  const gasLimit = estimate.mul(120).add(99).div(100);
  if (gasPrice.lte(0) || gasLimit.mul(gasPrice).gt(config.maxGasCost)) {
    throw reviewedCreationError('reviewed_creation_gas_cap');
  }
  if (balance.lt(gasLimit.mul(gasPrice))) throw reviewedCreationError('reviewed_creator_eth_low');
  if (Date.parse(spec.cutoff) <= clock()) throw reviewedCreationError('reviewed_cutoff_passed_before_signing');
  const unsignedSerialized = ethers.utils.serializeTransaction({
    to: call.to, data: call.data, chainId: config.chainId, nonce: pending, gasLimit, gasPrice,
  });
  const raw = await sign({ suborgId: config.suborgId, signWithAddress: spec.creator, unsignedSerialized });
  const parsed = ethers.utils.parseTransaction(raw);
  if (address(parsed.from) !== spec.creator
    || ethers.utils.serializeTransaction({
      to: parsed.to, data: parsed.data, chainId: parsed.chainId, nonce: parsed.nonce,
      gasLimit: parsed.gasLimit, gasPrice: parsed.gasPrice, value: parsed.value, type: parsed.type,
    }) !== unsignedSerialized) throw reviewedCreationError('reviewed_creation_invalid_signature');
  return { raw, hash: parsed.hash };
}

function receiptMarket(job, receipt) {
  const { spec } = job;
  const iface = factoryInterface(spec.version);
  const matching = (receipt.logs || []).filter(log => address(log.address) === spec.factory);
  const logs = matching.flatMap(log => {
    try { return [iface.parseLog(log)]; } catch { return []; }
  });
  const creates = logs.filter(log => log.name === 'MarketCreated');
  const commits = logs.filter(log => log.name === 'ResolutionRulesCommitted');
  const market = creates[0]?.args;
  const commit = commits[0]?.args;
  if (receipt.transactionHash !== job.tx_hash || address(receipt.to) !== spec.factory
    || address(receipt.from) !== spec.creator || creates.length !== 1 || commits.length !== 1
    || !market.marketId.eq(commit.marketId) || !address(market.pool)
    || commit.rulesHash !== job.rules_hash || market.question !== spec.question || market.category !== spec.category
    || !market.endTime.eq(Date.parse(spec.cutoff) / 1000)
    || (spec.version === 'v2' && (JSON.stringify(market.outcomes) !== JSON.stringify(spec.outcomes)
      || market.resolutionSource !== spec.resolutionSource))) return null;
  return { marketId: market.marketId.toString(), pool: address(market.pool) };
}

async function setStatus(client, id, status, error = null, marketId = null) {
  await client.query(`
    UPDATE protocol_reviewed_market_creations SET status = $2, last_error = $3,
      market_id = $4, updated_at = NOW(), attempted_at = NOW() WHERE pending_id = $1
  `, [id, status, error, marketId]);
  return { id, status, ...(error ? { error } : {}), ...(marketId ? { marketId } : {}) };
}

async function linkIndexedMarket(client, job, market) {
  const { pending_id: id, spec } = job;
  const { rows: [indexed] } = await client.query(`
    SELECT question, category, end_time, outcomes, status, outcome, resolved_at,
      resolution_review, tx_hash, pool_address, protocol_version
    FROM protocol_markets WHERE chain_id = $1 AND factory_address = $2 AND market_id::text = $3
  `, [chainFor(spec), spec.factory, market.marketId]);
  if (!indexed?.resolution_review) return { id, status: 'awaiting_index' };
  if (indexed.tx_hash !== job.tx_hash || indexed.resolution_review.rulesHash !== job.rules_hash
    || indexed.pool_address !== market.pool || indexed.protocol_version !== spec.version
    || indexed.question !== spec.question || indexed.category !== spec.category
    || new Date(indexed.end_time).toISOString() !== spec.cutoff
    || (JSON.stringify(indexed.outcomes) !== JSON.stringify(spec.outcomes)
      && !(spec.version === 'v1' && JSON.stringify(indexed.outcomes) === '["Sí","No"]'))) {
    return setStatus(client, id, 'needs_review', 'reviewed_index_mismatch');
  }
  const seed = ethers.utils.formatUnits(spec.seed, 6);
  const { rows: [points] } = await client.query(`
    INSERT INTO points_markets (
      source, source_event_id, question, category, outcomes, reserves, seed_liquidity,
      start_time, end_time, resolution_src, status, outcome, resolved_at, created_by, amm_mode, sport, league,
      outcome_images, featured, category_tags, geo_tags, topic_tags,
      mode, chain_id, chain_market_id, chain_address,
      resolver_type, resolver_config, seed_liquidities, tournament_featured, is_test_market
    )
    SELECT source, COALESCE($15, source_event_id), $2, $3, $4::jsonb, $5::jsonb, $6,
      start_time, $7, $8, $9, $10, $11, reviewer, 'unified', sport, league,
      outcome_images, featured, category_tags, geo_tags, topic_tags,
      'onchain', $12, $13, $14, COALESCE($16, resolver_type), COALESCE($17::jsonb, resolver_config),
      $5::jsonb, tournament_featured, is_test_market
    FROM points_pending_markets WHERE id = $1 AND status = 'creation_pending'
    ON CONFLICT (source, source_event_id) WHERE source IS NOT NULL AND source_event_id IS NOT NULL DO NOTHING
    RETURNING id
  `, [id, spec.question, spec.category, JSON.stringify(spec.outcomes),
    JSON.stringify(spec.outcomes.map(() => Number(seed))), seed, spec.cutoff,
    REVIEWED_RULES_PATH + job.rules_hash,
    ['under_review', 'disputed'].includes(indexed.status) ? 'active' : indexed.status,
    indexed.status === 'resolved' ? indexed.outcome - (spec.version === 'v1' ? 1 : 0) : null,
    indexed.resolved_at,
    chainFor(spec), market.marketId, market.pool, spec.sourceEventId ?? null,
    spec.resolverType ?? null, spec.resolverConfig ? JSON.stringify(spec.resolverConfig) : null]);
  if (!points) return setStatus(client, id, 'needs_review', 'reviewed_points_link_conflict');
  await client.query(`
    UPDATE points_pending_markets SET status = 'approved', approved_market_id = $2 WHERE id = $1
  `, [id, points.id]);
  return setStatus(client, id, 'listed', null, points.id);
}

async function advanceSignedCreation(client, job, provider, config, now) {
  const { pending_id: id } = job;
  const receipt = await provider.getTransactionReceipt(job.tx_hash);
  if (receipt) {
    const head = Number((await provider.send('eth_getBlockByNumber', ['finalized', false]))?.number);
    if (!Number.isSafeInteger(head) || head < 1) throw reviewedCreationError('reviewed_finalized_head_unavailable');
    if (receipt.blockNumber > head) return { id, status: 'awaiting_finality' };
    if (receipt.transactionHash !== job.tx_hash) throw reviewedCreationError('reviewed_receipt_hash_mismatch');
    if (receipt.status === 0) return setStatus(client, id, 'reverted', 'reviewed_transaction_reverted');
    const market = receipt.status === 1 && receiptMarket(job, receipt);
    if (!market) return setStatus(client, id, 'needs_review', 'reviewed_receipt_mismatch');
    return linkIndexedMarket(client, job, market);
  }

  // A signed nonce may already have reached the network. Never replace it
  // or advance to a new job until we can establish the original result.
  if (Date.parse(job.spec.cutoff) <= now) {
    return setStatus(client, id, 'signed', 'reviewed_cutoff_passed_without_receipt');
  }
  if (!config.broadcast) return { id, status: 'broadcast_paused' };
  if (await provider.getTransaction(job.tx_hash)) return { id, status: 'awaiting_receipt' };
  const tx = ethers.utils.parseTransaction(job.signed_transaction);
  if (tx.hash !== job.tx_hash || tx.chainId !== config.chainId
    || (job.spec.collateral ?? MXNB) !== config.collateral || ethers.BigNumber.from(job.spec.seed).gt(config.seed)
    || tx.data !== createCall(job, factoryInterface(job.spec.version)).data || !tx.value.isZero()
    || config.creator !== address(tx.from) || config.factories[job.spec.version] !== address(tx.to)) {
    return setStatus(client, id, 'signed', 'reviewed_signed_transaction_config_mismatch');
  }
  if (await provider.getTransactionCount(job.spec.creator, 'latest') > tx.nonce) {
    return setStatus(client, id, 'signed', 'reviewed_creator_nonce_consumed');
  }
  if (tx.gasLimit.mul(tx.gasPrice).gt(config.maxGasCost)) {
    return setStatus(client, id, 'signed', 'reviewed_creation_gas_cap');
  }
  return { id, raw: job.signed_transaction, hash: job.tx_hash, cutoff: job.spec.cutoff };
}

export async function runReviewedCreation({
  config, indexedFactories, pendingId = null,
  transaction = withTransaction,
  provider = new ethers.providers.JsonRpcProvider({ url: config.rpcUrl, timeout: 8000 }),
  sign = async args => (await import('./turnkey.js')).signTransactionForSuborg(args),
  verifyRouter = verifyTradingRouter,
  clock = Date.now,
}) {
  const now = clock();
  const next = await transaction(async client => {
    const { rows: [lock] } = await client.query(
      'SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS acquired', [config.chainId, signLock],
    );
    if (!lock.acquired) return { status: 'busy' };
    const { rows: [job] } = await client.query(`
      SELECT * FROM protocol_reviewed_market_creations
      WHERE status IN ('queued', 'signed')
        AND COALESCE((spec->>'chainId')::int, 42161) = $1
        AND (status = 'signed' OR $2::int IS NULL OR pending_id = $2)
      ORDER BY (status = 'signed') DESC, attempted_at NULLS FIRST, pending_id
      LIMIT 1 FOR UPDATE
    `, [config.chainId, pendingId]);
    if (!job) return { status: 'idle' };
    const { pending_id: id, spec, status } = job;
    if (status === 'queued' && Date.parse(spec.cutoff) <= now) {
      return setStatus(client, id, 'expired', 'reviewed_cutoff_passed_before_signing');
    }
    if (status === 'queued' && !config.broadcast) return { id, status: 'broadcast_paused' };

    try {
      if ((await provider.getNetwork()).chainId !== config.chainId) {
        throw reviewedCreationError('reviewed_creation_wrong_chain');
      }
      if (status === 'signed') return await advanceSignedCreation(client, job, provider, config, now);
      if ((spec.collateral ?? MXNB) !== config.collateral || ethers.BigNumber.from(spec.seed).gt(config.seed)
        || config.creator !== spec.creator || config.factories[spec.version] !== spec.factory
        || !isIndexedFactory(config.chainId, indexedFactories, spec.version, spec.factory)) {
        throw reviewedCreationError('reviewed_creator_config_changed');
      }
      if (config.chainId !== REVIEWED_CHAIN_ID) {
        const router = await verifyRouter({ provider }).catch(() => null);
        if (!router?.factories.includes(spec.factory)) throw reviewedCreationError('reviewed_trading_router_unverified');
      }
      const { raw, hash } = await signCreation(job, provider, config, sign, clock);
      await client.query(`
        UPDATE protocol_reviewed_market_creations
        SET status = 'signed', signed_transaction = $2, tx_hash = $3, last_error = NULL,
          attempted_at = NOW(), updated_at = NOW() WHERE pending_id = $1
      `, [id, raw, hash]);
      return { id, raw, hash, cutoff: spec.cutoff };
    } catch (error) {
      // RPC and signer exceptions can contain raw transactions or credentials.
      return setStatus(client, id, status, error.status === 409 ? error.message : 'reviewed_creation_check_failed');
    }
  });

  if (!next.raw) return next;
  if (Date.parse(next.cutoff) <= clock()) {
    return { id: next.id, status: 'signed', error: 'reviewed_cutoff_passed_before_broadcast' };
  }
  // The transaction above has committed. Concurrent deliveries can only
  // broadcast these same bytes and cannot create a second pool.
  try {
    const hash = await provider.send('eth_sendRawTransaction', [next.raw]);
    if (hash !== next.hash) throw new Error('reviewed_broadcast_hash_mismatch');
    return { id: next.id, status: 'broadcast', transactionHash: hash };
  } catch {
    return { id: next.id, status: 'broadcast_unconfirmed', transactionHash: next.hash };
  }
}
