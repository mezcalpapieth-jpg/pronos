import { neon } from '@neondatabase/serverless';
import { ethers } from 'ethers';

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
 */

const sql = neon(process.env.DATABASE_URL);

// ABIs — only the events we need
const FACTORY_ABI = [
  'event MarketCreated(uint256 indexed marketId, address pool, string question, string category, uint256 endTime)',
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

const BLOCK_BATCH = 2000; // Process 2000 blocks at a time
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

function getIndexerConfig() {
  const factoryAddress = firstEnv([
    'FACTORY_ADDRESS',
    'PRONOS_FACTORY_ADDRESS',
    CHAIN_ID === 421614 ? 'VITE_PRONOS_ARB_SEPOLIA_FACTORY' : 'VITE_PRONOS_ARBITRUM_FACTORY',
  ]);
  const rpcUrl = firstEnv([
    'ARB_RPC_URL',
    CHAIN_ID === 421614 ? 'ARB_SEPOLIA_RPC' : 'ARB_MAINNET_RPC',
    CHAIN_ID === 421614 ? 'ARBITRUM_SEPOLIA_RPC_URL' : 'ARBITRUM_RPC_URL',
  ]);
  const startBlock = parseInteger(process.env.INDEXER_START_BLOCK);
  return { factoryAddress, rpcUrl, startBlock };
}

export default async function handler(req, res) {
  // Auth: Vercel Cron sends Authorization header, manual calls use ?key=
  const cronSecret = process.env.CRON_SECRET;
  const indexerKey = process.env.INDEXER_KEY;
  const userAgent = req.headers['user-agent'] || '';
  const isVercelCron = cronSecret
    ? req.headers.authorization === `Bearer ${cronSecret}`
    : userAgent.includes('vercel-cron');
  const isManual = Boolean(indexerKey) && req.query.key === indexerKey;

  if (!isVercelCron && !isManual) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { factoryAddress, rpcUrl, startBlock } = getIndexerConfig();

  if (!factoryAddress || !rpcUrl) {
    return res.status(200).json({
      status: 'skipped',
      reason: 'MarketFactory address or Arbitrum RPC URL not configured',
    });
  }

  try {
    const provider = new ethers.providers.StaticJsonRpcProvider(rpcUrl, CHAIN_ID);
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);

    // Get last indexed block
    const stateRows = await sql`
      SELECT last_block FROM indexer_state WHERE chain_id = ${CHAIN_ID}
    `;
    let fromBlock = stateRows.length > 0 ? parseInt(stateRows[0].last_block) + 1 : 0;

    // If first run and no state, start from deploy block (or recent)
    if (fromBlock === 0) {
      const currentBlock = await provider.getBlockNumber();
      fromBlock = startBlock != null ? startBlock : Math.max(0, currentBlock - 10000); // Last ~10k blocks
    }

    const currentBlock = await provider.getBlockNumber();
    const toBlock = Math.min(fromBlock + BLOCK_BATCH, currentBlock);

    if (fromBlock > currentBlock) {
      return res.status(200).json({ status: 'up_to_date', block: currentBlock });
    }

    let processed = { markets: 0, liquidity: 0, trades: 0, resolutions: 0 };

    // ── Index MarketCreated events ──────────────────────────────────────────
    const createFilter = factory.filters.MarketCreated();
    const createEvents = await factory.queryFilter(createFilter, fromBlock, toBlock);

    for (const event of createEvents) {
      const { marketId, pool, question, category, endTime } = event.args;
      const seedLiquidity = await readPoolSeedLiquidity(provider, pool, event.blockNumber);
      await sql`
        INSERT INTO protocol_markets (chain_id, factory_address, pool_address, market_id, question, category, end_time, tx_hash, seed_liquidity)
        VALUES (${CHAIN_ID}, ${factoryAddress}, ${pool}, ${marketId.toNumber()}, ${question}, ${category}, ${new Date(endTime.toNumber() * 1000).toISOString()}, ${event.transactionHash}, ${seedLiquidity})
        ON CONFLICT (chain_id, market_id) DO UPDATE SET
          pool_address = EXCLUDED.pool_address,
          factory_address = EXCLUDED.factory_address,
          seed_liquidity = CASE
            WHEN COALESCE(protocol_markets.seed_liquidity, 0) = 0 THEN EXCLUDED.seed_liquidity
            ELSE protocol_markets.seed_liquidity
          END
      `;
      processed.markets++;
    }

    // ── Index MarketResolved events ─────────────────────────────────────────
    const resolveFilter = factory.filters.MarketResolved();
    const resolveEvents = await factory.queryFilter(resolveFilter, fromBlock, toBlock);

    for (const event of resolveEvents) {
      const { marketId, outcome } = event.args;
      await sql`
        UPDATE protocol_markets
        SET status = 'resolved', outcome = ${outcome}, resolved_at = NOW()
        WHERE chain_id = ${CHAIN_ID} AND market_id = ${marketId.toNumber()}
      `;
      processed.resolutions++;
    }

    // ── Index trades from all known AMM pools ───────────────────────────────
    const pools = await sql`
      SELECT id, pool_address, market_id FROM protocol_markets
      WHERE chain_id = ${CHAIN_ID}
        AND LOWER(factory_address) = LOWER(${factoryAddress})
        AND status = 'active'
    `;

    for (const pool of pools) {
      const amm = new ethers.Contract(pool.pool_address, AMM_ABI, provider);

      // Seed liquidity is emitted by the pool during factory.createMarket().
      // The factory emits MarketCreated after that, so we index it here once
      // the pool address is known.
      const liquidityFilter = amm.filters.LiquidityAdded();
      const liquidityEvents = await amm.queryFilter(liquidityFilter, fromBlock, toBlock);

      for (const event of liquidityEvents) {
        const amount = parseFloat(ethers.utils.formatUnits(event.args.amount, 6));
        await sql`
          UPDATE protocol_markets
          SET seed_liquidity = CASE
            WHEN COALESCE(seed_liquidity, 0) = 0 THEN ${amount}
            ELSE seed_liquidity
          END
          WHERE id = ${pool.id}
        `;
        processed.liquidity++;
      }

      // SharesBought events
      const buyFilter = amm.filters.SharesBought();
      const buyEvents = await amm.queryFilter(buyFilter, fromBlock, toBlock);

      for (const event of buyEvents) {
        const { buyer, isYes, collateralIn, fee, sharesOut } = event.args;
        const collateral = parseFloat(ethers.utils.formatUnits(collateralIn, 6));
        const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
        const shares = parseFloat(ethers.utils.formatUnits(sharesOut, 6));
        const netCollateral = Math.max(0, collateral - feeAmt);
        const price = shares > 0 ? netCollateral / shares : 0;

        await sql`
          INSERT INTO trades (market_id, trader, side, is_yes, collateral_amt, shares_amt, fee_amt, price_at_trade, tx_hash, block_number, log_index)
          VALUES (${pool.id}, ${buyer.toLowerCase()}, 'buy', ${isYes}, ${collateral}, ${shares}, ${feeAmt}, ${price}, ${event.transactionHash}, ${event.blockNumber}, ${event.logIndex})
          ON CONFLICT (tx_hash, log_index) DO NOTHING
        `;

        // Update position
        await upsertPosition(pool.id, buyer.toLowerCase(), isYes, shares, collateral);
        processed.trades++;
      }

      // SharesSold events
      const sellFilter = amm.filters.SharesSold();
      const sellEvents = await amm.queryFilter(sellFilter, fromBlock, toBlock);

      for (const event of sellEvents) {
        const { seller, isYes, sharesIn, collateralOut, fee } = event.args;
        const collateral = parseFloat(ethers.utils.formatUnits(collateralOut, 6));
        const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
        const shares = parseFloat(ethers.utils.formatUnits(sharesIn, 6));
        const price = shares > 0 ? collateral / shares : 0;

        await sql`
          INSERT INTO trades (market_id, trader, side, is_yes, collateral_amt, shares_amt, fee_amt, price_at_trade, tx_hash, block_number, log_index)
          VALUES (${pool.id}, ${seller.toLowerCase()}, 'sell', ${isYes}, ${collateral}, ${shares}, ${feeAmt}, ${price}, ${event.transactionHash}, ${event.blockNumber}, ${event.logIndex})
          ON CONFLICT (tx_hash, log_index) DO NOTHING
        `;

        await upsertPosition(pool.id, seller.toLowerCase(), isYes, -shares, -collateral);
        processed.trades++;
      }

      // Snapshot current price from AMM reserves
      try {
        const reserveYes = parseFloat(ethers.utils.formatUnits(await amm.reserveYes({ blockTag: toBlock }), 6));
        const reserveNo = parseFloat(ethers.utils.formatUnits(await amm.reserveNo({ blockTag: toBlock }), 6));
        const total = reserveYes + reserveNo;
        if (total > 0) {
          const yesPrice = reserveNo / total; // CPMM: price = opposite_reserve / total
          const noPrice = reserveYes / total;
          const volumeRows = await sql`
            SELECT COALESCE(SUM(collateral_amt), 0) as total
            FROM trades
            WHERE market_id = ${pool.id}
              AND created_at >= NOW() - INTERVAL '24 hours'
          `;
          const volume24h = Number(volumeRows[0]?.total || 0);
          await sql`
            INSERT INTO price_snapshots (market_id, yes_price, no_price, volume_24h, liquidity)
            VALUES (${pool.id}, ${yesPrice}, ${noPrice}, ${volume24h}, ${total})
          `;
        }
      } catch (_) {
        // Pool might not be initialized yet
      }
    }

    // ── Update indexer state ────────────────────────────────────────────────
    await sql`
      INSERT INTO indexer_state (chain_id, last_block, updated_at)
      VALUES (${CHAIN_ID}, ${toBlock}, NOW())
      ON CONFLICT (chain_id) DO UPDATE SET last_block = ${toBlock}, updated_at = NOW()
    `;

    return res.status(200).json({
      status: 'ok',
      fromBlock,
      toBlock,
      processed,
    });
  } catch (e) {
    console.error('Indexer error:', e);
    return res.status(500).json({ error: 'Indexer failed', detail: e.message });
  }
}

async function readPoolSeedLiquidity(provider, poolAddress, blockNumber) {
  try {
    const amm = new ethers.Contract(poolAddress, AMM_ABI, provider);
    const reserveYes = await amm.reserveYes({ blockTag: blockNumber });
    return parseFloat(ethers.utils.formatUnits(reserveYes, 6));
  } catch (_) {
    return 0;
  }
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
