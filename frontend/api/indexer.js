import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';
import { ensureProtocolSchema } from './_lib/protocol-schema.js';

/**
 * /api/indexer — On-chain event indexer for Pronos protocol.
 *
 * Triggered via Vercel Cron (every 30s) or manual GET /api/indexer?key=<INDEXER_KEY>.
 * Reads MarketCreated, SharesBought, SharesSold, MarketResolved events
 * from the MarketFactory and AMM contracts, writes to Neon PostgreSQL.
 *
 * Environment variables required:
 *   DATABASE_URL       — Neon PostgreSQL connection
 *   INDEXER_KEY        — Auth key for manual triggers
 *   FACTORY_ADDRESS    — Deployed MarketFactory address
 *   ARB_RPC_URL        — Arbitrum RPC endpoint
 *
 * Supported aliases for Arbitrum Sepolia deployments:
 *   PROTOCOL_CHAIN_ID / CHAIN_ID
 *   PRONOS_FACTORY_ADDRESS / VITE_PRONOS_ARB_SEPOLIA_FACTORY
 *   ARB_SEPOLIA_RPC / ARBITRUM_SEPOLIA_RPC_URL
 *   INDEXER_START_BLOCK (optional; first run only)
 *   INDEXER_LOOKBACK_BLOCKS (optional; first per-factory run lookback)
 *   INDEXER_MAX_BATCHES (optional; batches processed per invocation)
 */

const sql = neon(process.env.DATABASE_URL);

// ABIs — only the events we need
const FACTORY_ABI = [
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime)',
  'event MarketResolved(uint256 indexed marketId, uint8 outcome)',
  'event MarketPaused(uint256 indexed marketId, bool paused)',
  'event FeesDistributed(uint256 treasury, uint256 liquidity, uint256 emergency)',
];

const FACTORY_V2_ABI = [
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime, string resolutionSource, string[] outcomes)',
  'event MarketResolved(uint256 indexed marketId, uint8 outcome)',
  'event MarketPaused(uint256 indexed marketId, bool paused)',
  'event FeesDistributed(uint256 treasury, uint256 liquidity, uint256 emergency)',
];

const AMM_ABI = [
  'event SharesBought(address indexed buyer, bool isYes, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, bool isYes, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
  'event LiquidityAdded(address indexed provider, uint256 amount)',
  'event WinningsRedeemed(address indexed user, uint256 shares, uint256 payout)',
  'function reserveYes() view returns (uint256)',
  'function reserveNo() view returns (uint256)',
];

const AMM_MULTI_ABI = [
  'event SharesBought(address indexed buyer, uint8 indexed outcomeIndex, uint256 collateralIn, uint256 fee, uint256 sharesOut)',
  'event SharesSold(address indexed seller, uint8 indexed outcomeIndex, uint256 sharesIn, uint256 collateralOut, uint256 fee)',
  'event LiquidityAdded(address indexed provider, uint256 amount)',
  'event WinningsRedeemed(address indexed user, uint8 indexed outcomeIndex, uint256 shares, uint256 payout)',
  'function reserves(uint256) view returns (uint256)',
  'function prices() view returns (uint256[])',
  'function outcomeCount() view returns (uint8)',
];

const BLOCK_BATCH = 2000; // Process 2000 blocks at a time
const DEFAULT_LOOKBACK_BLOCKS = 250000;
const DEFAULT_MAX_BATCHES = 5;
const CHAIN_ID = parseInteger(process.env.CHAIN_ID) || parseInteger(process.env.PROTOCOL_CHAIN_ID) || 421614;

function parseInteger(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

function getFactoryConfigs() {
  const v1Factory = firstEnv([
    'FACTORY_ADDRESS',
    'PRONOS_FACTORY_ADDRESS',
    CHAIN_ID === 421614 ? 'VITE_PRONOS_ARB_SEPOLIA_FACTORY' : 'VITE_PRONOS_ARBITRUM_FACTORY',
  ]);
  const v2Factory = firstEnv([
    'FACTORY_V2_ADDRESS',
    'PRONOS_FACTORY_V2_ADDRESS',
    CHAIN_ID === 421614 ? 'VITE_PRONOS_ARB_SEPOLIA_FACTORY_V2' : 'VITE_PRONOS_ARBITRUM_FACTORY_V2',
  ]);
  const seen = new Set();
  return [
    v1Factory ? { version: 'v1', address: v1Factory.toLowerCase(), abi: FACTORY_ABI } : null,
    v2Factory ? { version: 'v2', address: v2Factory.toLowerCase(), abi: FACTORY_V2_ABI } : null,
  ].filter((config) => {
    if (!config || seen.has(config.address)) return false;
    seen.add(config.address);
    return true;
  });
}

function getIndexerConfig() {
  const rpcUrl = firstEnv([
    'ARB_RPC_URL',
    CHAIN_ID === 421614 ? 'ARB_SEPOLIA_RPC' : 'ARB_MAINNET_RPC',
    CHAIN_ID === 421614 ? 'ARBITRUM_SEPOLIA_RPC_URL' : 'ARBITRUM_RPC_URL',
  ]);
  const startBlock = parseInteger(process.env.INDEXER_START_BLOCK);
  const lookbackBlocks = parseInteger(process.env.INDEXER_LOOKBACK_BLOCKS) || DEFAULT_LOOKBACK_BLOCKS;
  const maxBatches = parseInteger(process.env.INDEXER_MAX_BATCHES) || DEFAULT_MAX_BATCHES;
  return { factories: getFactoryConfigs(), rpcUrl, startBlock, lookbackBlocks, maxBatches };
}

export default async function handler(req, res) {
  // Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>.
  // Manual triggers use ?key=<INDEXER_KEY>.
  //
  // IMPORTANT: we no longer allow User-Agent: vercel-cron as a fallback when
  // CRON_SECRET is unset — that header is trivially spoofable and was leaving
  // the indexer fully open on any deploy where the env var wasn't configured.
  // Local dev (no VERCEL_ENV) still accepts the UA fallback for convenience.
  const cronSecret = process.env.CRON_SECRET;
  const indexerKey = process.env.INDEXER_KEY;
  const userAgent = req.headers['user-agent'] || '';
  const isVercelDeploy = Boolean(process.env.VERCEL_ENV);

  let isVercelCron = false;
  if (cronSecret) {
    isVercelCron = req.headers.authorization === `Bearer ${cronSecret}`;
  } else if (!isVercelDeploy) {
    // Local dev only — UA-based fallback so `vercel dev` works without config.
    isVercelCron = userAgent.includes('vercel-cron');
  }
  // On a Vercel deploy with no CRON_SECRET set, isVercelCron stays false
  // and the endpoint is effectively disabled until the secret is wired up.

  const isManual = Boolean(indexerKey) && req.query.key === indexerKey;

  if (!isVercelCron && !isManual) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { factories, rpcUrl, startBlock, lookbackBlocks, maxBatches: configuredMaxBatches } = getIndexerConfig();

  if (!factories.length || !rpcUrl) {
    return res.status(200).json({
      status: 'skipped',
      reason: 'MarketFactory address or Arbitrum RPC URL not configured',
    });
  }

  try {
    const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, CHAIN_ID);
    await ensureProtocolSchema(sql);
    await ensureFactoryStateTable();

    const currentBlock = await provider.getBlockNumber();
    const manualFromBlock = isManual ? parseInteger(req.query.fromBlock) : null;
    const manualToBlock = isManual ? parseInteger(req.query.toBlock) : null;
    const maxBatches = Math.min(Math.max(parseInteger(req.query.maxBatches) || configuredMaxBatches, 1), 25);
    let processed = { markets: 0, liquidity: 0, trades: 0, resolutions: 0, redemptions: 0 };
    const factoryRuns = [];

    for (const factoryConfig of factories) {
      let fromBlock = manualFromBlock ?? await getFactoryFromBlock(factoryConfig.address, startBlock, currentBlock, lookbackBlocks);
      const targetBlock = Math.min(manualToBlock ?? currentBlock, currentBlock);
      let batches = 0;

      if (fromBlock > targetBlock) {
        factoryRuns.push({
          version: factoryConfig.version,
          address: factoryConfig.address,
          status: 'up_to_date',
          fromBlock,
          toBlock: targetBlock,
        });
        continue;
      }

      while (fromBlock <= targetBlock && batches < maxBatches) {
        const toBlock = Math.min(fromBlock + BLOCK_BATCH - 1, targetBlock);
        const before = { ...processed };
        await indexFactoryRange(provider, factoryConfig, fromBlock, toBlock, processed);
        await updateFactoryState(factoryConfig.address, toBlock);
        factoryRuns.push({
          version: factoryConfig.version,
          address: factoryConfig.address,
          status: 'ok',
          fromBlock,
          toBlock,
          processed: {
            markets: processed.markets - before.markets,
            liquidity: processed.liquidity - before.liquidity,
            trades: processed.trades - before.trades,
            resolutions: processed.resolutions - before.resolutions,
            redemptions: processed.redemptions - before.redemptions,
          },
        });
        fromBlock = toBlock + 1;
        batches++;
      }
    }

    // Keep the legacy chain-level state moving for existing dashboards/scripts.
    const highestBlock = factoryRuns.reduce((max, run) => Math.max(max, run.toBlock || 0), 0);
    await sql`
      INSERT INTO indexer_state (chain_id, last_block, updated_at)
      VALUES (${CHAIN_ID}, ${highestBlock}, NOW())
      ON CONFLICT (chain_id) DO UPDATE SET last_block = GREATEST(indexer_state.last_block, EXCLUDED.last_block), updated_at = NOW()
    `;

    return res.status(200).json({
      status: 'ok',
      block: currentBlock,
      factories: factoryRuns,
      processed,
    });
  } catch (e) {
    console.error('Indexer error:', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack?.split('\n').slice(0, 5).join('\n'),
    });
    return res.status(500).json({ error: 'Indexer failed' });
  }
}

async function ensureFactoryStateTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS indexer_factory_state (
      chain_id INTEGER NOT NULL,
      factory_address TEXT NOT NULL,
      last_block BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (chain_id, factory_address)
    )
  `;
}

async function getFactoryFromBlock(factoryAddress, startBlock, currentBlock, lookbackBlocks) {
  const stateRows = await sql`
    SELECT last_block
    FROM indexer_factory_state
    WHERE chain_id = ${CHAIN_ID}
      AND factory_address = ${factoryAddress}
  `;
  if (stateRows.length > 0) return parseInt(stateRows[0].last_block, 10) + 1;
  if (startBlock != null) return startBlock;
  return Math.max(0, currentBlock - lookbackBlocks);
}

async function updateFactoryState(factoryAddress, toBlock) {
  await sql`
    INSERT INTO indexer_factory_state (chain_id, factory_address, last_block, updated_at)
    VALUES (${CHAIN_ID}, ${factoryAddress}, ${toBlock}, NOW())
    ON CONFLICT (chain_id, factory_address) DO UPDATE SET
      last_block = GREATEST(indexer_factory_state.last_block, EXCLUDED.last_block),
      updated_at = NOW()
  `;
}

async function indexFactoryRange(provider, factoryConfig, fromBlock, toBlock, processed) {
  const factory = new ethers.Contract(factoryConfig.address, factoryConfig.abi, provider);

  const createEvents = await factory.queryFilter(factory.filters.MarketCreated(), fromBlock, toBlock);
  for (const event of createEvents) {
    const { marketId, pool, question, category, endTime } = event.args;
    const outcomes = factoryConfig.version === 'v2'
      ? Array.from(event.args.outcomes || [])
      : ['Sí', 'No'];
    const resolutionSource = factoryConfig.version === 'v2' ? event.args.resolutionSource : null;
    const poolAddress = pool.toLowerCase();
    const seedLiquidity = await readPoolSeedLiquidity(provider, poolAddress, event.blockNumber, factoryConfig.version);
    await sql`
      INSERT INTO protocol_markets (
        chain_id, factory_address, pool_address, market_id, question, category,
        end_time, resolution_src, tx_hash, seed_liquidity, protocol_version,
        outcome_count, outcomes
      )
      VALUES (
        ${CHAIN_ID}, ${factoryConfig.address}, ${poolAddress}, ${marketId.toNumber()},
        ${question}, ${category}, ${new Date(endTime.toNumber() * 1000).toISOString()},
        ${resolutionSource}, ${event.transactionHash}, ${seedLiquidity}, ${factoryConfig.version},
        ${outcomes.length}, ${JSON.stringify(outcomes)}::jsonb
      )
      ON CONFLICT (chain_id, factory_address, market_id) DO UPDATE SET
        pool_address = EXCLUDED.pool_address,
        question = EXCLUDED.question,
        category = EXCLUDED.category,
        end_time = EXCLUDED.end_time,
        resolution_src = EXCLUDED.resolution_src,
        protocol_version = EXCLUDED.protocol_version,
        outcome_count = EXCLUDED.outcome_count,
        outcomes = EXCLUDED.outcomes,
        seed_liquidity = CASE
          WHEN COALESCE(protocol_markets.seed_liquidity, 0) = 0 THEN EXCLUDED.seed_liquidity
          ELSE protocol_markets.seed_liquidity
        END
    `;
    processed.markets++;
  }

  const resolveEvents = await factory.queryFilter(factory.filters.MarketResolved(), fromBlock, toBlock);
  for (const event of resolveEvents) {
    const { marketId, outcome } = event.args;
    await sql`
      UPDATE protocol_markets
      SET status = 'resolved', outcome = ${outcome}, resolved_at = NOW()
      WHERE chain_id = ${CHAIN_ID}
        AND factory_address = ${factoryConfig.address}
        AND market_id = ${marketId.toNumber()}
    `;
    processed.resolutions++;
  }

  const pools = await sql`
    SELECT id, pool_address, market_id, protocol_version, outcome_count
    FROM protocol_markets
    WHERE chain_id = ${CHAIN_ID}
      AND factory_address = ${factoryConfig.address}
      AND COALESCE(status, 'active') = 'active'
  `;

  for (const pool of pools) {
    if (pool.protocol_version === 'v2') {
      await indexV2Pool(provider, pool, fromBlock, toBlock, processed);
    } else {
      await indexV1Pool(provider, pool, fromBlock, toBlock, processed);
    }
  }
}

async function indexV1Pool(provider, pool, fromBlock, toBlock, processed) {
  const amm = new ethers.Contract(pool.pool_address, AMM_ABI, provider);

  const liquidityEvents = await amm.queryFilter(amm.filters.LiquidityAdded(), fromBlock, toBlock);
  for (const event of liquidityEvents) {
    const amount = parseFloat(ethers.utils.formatUnits(event.args.amount, 6));
    await updateSeedLiquidity(pool.id, amount);
    processed.liquidity++;
  }

  const buyEvents = await amm.queryFilter(amm.filters.SharesBought(), fromBlock, toBlock);
  for (const event of buyEvents) {
    const { buyer, isYes, collateralIn, fee, sharesOut } = event.args;
    const collateral = parseFloat(ethers.utils.formatUnits(collateralIn, 6));
    const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
    const shares = parseFloat(ethers.utils.formatUnits(sharesOut, 6));
    const netCollateral = Math.max(0, collateral - feeAmt);
    const price = shares > 0 ? netCollateral / shares : 0;
    const outcomeIndex = isYes ? 0 : 1;

    const inserted = await insertTrade({
      marketId: pool.id,
      trader: buyer.toLowerCase(),
      side: 'buy',
      isYes,
      outcomeIndex,
      collateral,
      shares,
      feeAmt,
      price,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    });
    if (!inserted) continue;

    await upsertPosition(pool.id, buyer.toLowerCase(), isYes, shares, collateral);
    processed.trades++;
  }

  const sellEvents = await amm.queryFilter(amm.filters.SharesSold(), fromBlock, toBlock);
  for (const event of sellEvents) {
    const { seller, isYes, sharesIn, collateralOut, fee } = event.args;
    const collateral = parseFloat(ethers.utils.formatUnits(collateralOut, 6));
    const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
    const shares = parseFloat(ethers.utils.formatUnits(sharesIn, 6));
    const price = shares > 0 ? collateral / shares : 0;
    const outcomeIndex = isYes ? 0 : 1;

    const inserted = await insertTrade({
      marketId: pool.id,
      trader: seller.toLowerCase(),
      side: 'sell',
      isYes,
      outcomeIndex,
      collateral,
      shares,
      feeAmt,
      price,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    });
    if (!inserted) continue;

    await upsertPosition(pool.id, seller.toLowerCase(), isYes, -shares, -collateral);
    processed.trades++;
  }

  // WinningsRedeemed: user called redeem() after market resolved, burning
  // winning shares 1:1 for USDC. We store the authoritative on-chain payout
  // so the Historial tab can show exact win amounts instead of estimating.
  const redeemEvents = await amm.queryFilter(amm.filters.WinningsRedeemed(), fromBlock, toBlock);
  for (const event of redeemEvents) {
    const { user, shares: sharesRaw, payout: payoutRaw } = event.args;
    const shares = parseFloat(ethers.utils.formatUnits(sharesRaw, 6));
    const payout = parseFloat(ethers.utils.formatUnits(payoutRaw, 6));
    const inserted = await insertRedemption({
      marketId: pool.id,
      userAddress: user.toLowerCase(),
      outcomeIndex: null, // v1 has a single winning side per market
      shares,
      payout,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    });
    if (inserted) processed.redemptions++;
  }

  try {
    const reserveYes = parseFloat(ethers.utils.formatUnits(await amm.reserveYes({ blockTag: toBlock }), 6));
    const reserveNo = parseFloat(ethers.utils.formatUnits(await amm.reserveNo({ blockTag: toBlock }), 6));
    const total = reserveYes + reserveNo;
    if (total > 0) {
      const yesPrice = reserveNo / total;
      const noPrice = reserveYes / total;
      // Liquidity = matched collateral (redeemable USDC). In a binary CPMM
      // with pair-minted tokens, that's min(reserveYes, reserveNo). Using
      // the sum here would double-count the unmatched excess that only
      // represents IOUs to one side, inflating TVL ~2×.
      const liquidity = Math.min(reserveYes, reserveNo);
      const volume24h = await readVolume24h(pool.id);
      await sql`
        INSERT INTO price_snapshots (market_id, yes_price, no_price, volume_24h, liquidity, prices)
        VALUES (${pool.id}, ${yesPrice}, ${noPrice}, ${volume24h}, ${liquidity}, ${JSON.stringify([yesPrice, noPrice])}::jsonb)
      `;
    }
  } catch (_) {}
}

async function indexV2Pool(provider, pool, fromBlock, toBlock, processed) {
  const amm = new ethers.Contract(pool.pool_address, AMM_MULTI_ABI, provider);

  const liquidityEvents = await amm.queryFilter(amm.filters.LiquidityAdded(), fromBlock, toBlock);
  for (const event of liquidityEvents) {
    const amount = parseFloat(ethers.utils.formatUnits(event.args.amount, 6));
    await updateSeedLiquidity(pool.id, amount);
    processed.liquidity++;
  }

  const buyEvents = await amm.queryFilter(amm.filters.SharesBought(), fromBlock, toBlock);
  for (const event of buyEvents) {
    const { buyer, outcomeIndex, collateralIn, fee, sharesOut } = event.args;
    const index = outcomeIndex.toNumber?.() ?? Number(outcomeIndex);
    const collateral = parseFloat(ethers.utils.formatUnits(collateralIn, 6));
    const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
    const shares = parseFloat(ethers.utils.formatUnits(sharesOut, 6));
    const netCollateral = Math.max(0, collateral - feeAmt);
    const price = shares > 0 ? netCollateral / shares : 0;

    const inserted = await insertTrade({
      marketId: pool.id,
      trader: buyer.toLowerCase(),
      side: 'buy',
      isYes: index === 0,
      outcomeIndex: index,
      collateral,
      shares,
      feeAmt,
      price,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    });
    if (!inserted) continue;

    await upsertOutcomePosition(pool.id, buyer.toLowerCase(), index, shares, collateral);
    processed.trades++;
  }

  const sellEvents = await amm.queryFilter(amm.filters.SharesSold(), fromBlock, toBlock);
  for (const event of sellEvents) {
    const { seller, outcomeIndex, sharesIn, collateralOut, fee } = event.args;
    const index = outcomeIndex.toNumber?.() ?? Number(outcomeIndex);
    const collateral = parseFloat(ethers.utils.formatUnits(collateralOut, 6));
    const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
    const shares = parseFloat(ethers.utils.formatUnits(sharesIn, 6));
    const price = shares > 0 ? collateral / shares : 0;

    const inserted = await insertTrade({
      marketId: pool.id,
      trader: seller.toLowerCase(),
      side: 'sell',
      isYes: index === 0,
      outcomeIndex: index,
      collateral,
      shares,
      feeAmt,
      price,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    });
    if (!inserted) continue;

    await upsertOutcomePosition(pool.id, seller.toLowerCase(), index, -shares, -collateral);
    processed.trades++;
  }

  // v2 redemptions include outcomeIndex so we can attribute the payout to
  // the specific winning outcome (important for markets with 3+ options).
  const redeemEvents = await amm.queryFilter(amm.filters.WinningsRedeemed(), fromBlock, toBlock);
  for (const event of redeemEvents) {
    const { user, outcomeIndex, shares: sharesRaw, payout: payoutRaw } = event.args;
    const index = outcomeIndex.toNumber?.() ?? Number(outcomeIndex);
    const shares = parseFloat(ethers.utils.formatUnits(sharesRaw, 6));
    const payout = parseFloat(ethers.utils.formatUnits(payoutRaw, 6));
    const inserted = await insertRedemption({
      marketId: pool.id,
      userAddress: user.toLowerCase(),
      outcomeIndex: index,
      shares,
      payout,
      txHash: event.transactionHash,
      blockNumber: event.blockNumber,
      logIndex: event.logIndex,
    });
    if (inserted) processed.redemptions++;
  }

  try {
    const count = Number(pool.outcome_count || await amm.outcomeCount({ blockTag: toBlock }));
    const priceRaw = await amm.prices({ blockTag: toBlock });
    const prices = priceRaw.map(p => Number(p) / 1e6);
    const reserveReads = [];
    for (let i = 0; i < count; i++) {
      reserveReads.push(amm.reserves(i, { blockTag: toBlock }));
    }
    const reserveRaw = await Promise.all(reserveReads);
    const reserves = reserveRaw.map(value => parseFloat(ethers.utils.formatUnits(value, 6)));
    // Liquidity = matched complete-sets redeemable for USDC. In a multi-
    // outcome CPMM one complete set (1 token of each outcome) = 1 USDC,
    // so the pool can redeem min(reserves) complete sets. Summing reserves
    // here would overstate TVL by a factor of N (outcomeCount).
    const liquidity = reserves.length > 0 ? Math.min(...reserves) : 0;
    const volume24h = await readVolume24h(pool.id);

    await sql`
      INSERT INTO price_snapshots (market_id, yes_price, no_price, volume_24h, liquidity, prices)
      VALUES (${pool.id}, ${prices[0] || 0}, ${prices[1] || 0}, ${volume24h}, ${liquidity}, ${JSON.stringify(prices)}::jsonb)
    `;
  } catch (_) {}
}

async function updateSeedLiquidity(marketId, amount) {
  await sql`
    UPDATE protocol_markets
    SET seed_liquidity = CASE
      WHEN COALESCE(seed_liquidity, 0) = 0 THEN ${amount}
      ELSE seed_liquidity
    END
    WHERE id = ${marketId}
  `;
}

async function readVolume24h(marketId) {
  const volumeRows = await sql`
    SELECT COALESCE(SUM(collateral_amt), 0) as total
    FROM trades
    WHERE market_id = ${marketId}
      AND created_at >= NOW() - INTERVAL '24 hours'
  `;
  return Number(volumeRows[0]?.total || 0);
}

async function readPoolSeedLiquidity(provider, poolAddress, blockNumber, version) {
  try {
    const amm = new ethers.Contract(poolAddress, version === 'v2' ? AMM_MULTI_ABI : AMM_ABI, provider);
    const reserve = version === 'v2'
      ? await amm.reserves(0, { blockTag: blockNumber })
      : await amm.reserveYes({ blockTag: blockNumber });
    return parseFloat(ethers.utils.formatUnits(reserve, 6));
  } catch (_) {
    return 0;
  }
}

async function insertTrade({
  marketId,
  trader,
  side,
  isYes,
  outcomeIndex,
  collateral,
  shares,
  feeAmt,
  price,
  txHash,
  blockNumber,
  logIndex,
}) {
  const rows = await sql`
    INSERT INTO trades (market_id, trader, side, is_yes, outcome_index, collateral_amt, shares_amt, fee_amt, price_at_trade, tx_hash, block_number, log_index)
    VALUES (${marketId}, ${trader}, ${side}, ${isYes}, ${outcomeIndex}, ${collateral}, ${shares}, ${feeAmt}, ${price}, ${txHash}, ${blockNumber}, ${logIndex})
    ON CONFLICT (tx_hash, log_index) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

async function insertRedemption({
  marketId,
  userAddress,
  outcomeIndex,
  shares,
  payout,
  txHash,
  blockNumber,
  logIndex,
}) {
  const rows = await sql`
    INSERT INTO redemptions (market_id, user_address, outcome_index, shares, payout, tx_hash, block_number, log_index)
    VALUES (${marketId}, ${userAddress}, ${outcomeIndex}, ${shares}, ${payout}, ${txHash}, ${blockNumber}, ${logIndex})
    ON CONFLICT (tx_hash, log_index) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

async function upsertPosition(marketId, userAddress, isYes, sharesDelta, costDelta) {
  if (isYes) {
    await sql`
      INSERT INTO positions (market_id, user_address, yes_shares, total_cost)
      VALUES (${marketId}, ${userAddress}, ${Math.max(0, sharesDelta)}, ${Math.max(0, costDelta)})
      ON CONFLICT (market_id, user_address) DO UPDATE SET
        yes_shares = GREATEST(0, positions.yes_shares + ${sharesDelta}),
        total_cost = GREATEST(0, positions.total_cost + ${costDelta}),
        updated_at = NOW()
    `;
  } else {
    await sql`
      INSERT INTO positions (market_id, user_address, no_shares, total_cost)
      VALUES (${marketId}, ${userAddress}, ${Math.max(0, sharesDelta)}, ${Math.max(0, costDelta)})
      ON CONFLICT (market_id, user_address) DO UPDATE SET
        no_shares = GREATEST(0, positions.no_shares + ${sharesDelta}),
        total_cost = GREATEST(0, positions.total_cost + ${costDelta}),
        updated_at = NOW()
    `;
  }
}

async function upsertOutcomePosition(marketId, userAddress, outcomeIndex, sharesDelta, costDelta) {
  await sql`
    INSERT INTO outcome_positions (market_id, user_address, outcome_index, shares, total_cost)
    VALUES (${marketId}, ${userAddress}, ${outcomeIndex}, ${Math.max(0, sharesDelta)}, ${Math.max(0, costDelta)})
    ON CONFLICT (market_id, user_address, outcome_index) DO UPDATE SET
      shares = GREATEST(0, outcome_positions.shares + ${sharesDelta}),
      total_cost = GREATEST(0, outcome_positions.total_cost + ${costDelta}),
      updated_at = NOW()
  `;
}
