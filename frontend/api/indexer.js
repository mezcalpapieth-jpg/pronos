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
 *   DATABASE_URL     — Neon PostgreSQL connection
 *   INDEXER_KEY      — Auth key for manual triggers
 *   ARB_RPC_URL      — Arbitrum RPC endpoint (Sepolia or mainnet)
 *   FACTORY_ADDRESS  — Deployed MarketFactory address
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

const CHAIN_ID = parseInt(process.env.CHAIN_ID || '421614');
const BLOCK_BATCH = 2000; // Process 2000 blocks at a time

export default async function handler(req, res) {
  // Auth: Vercel Cron sends Authorization header, manual calls use ?key=
  const isVercelCron = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = req.query.key === process.env.INDEXER_KEY;

  if (!isVercelCron && !isManual) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const factoryAddress = process.env.FACTORY_ADDRESS;
  const rpcUrl = process.env.ARB_RPC_URL;

  if (!factoryAddress || !rpcUrl) {
    return res.status(200).json({
      status: 'skipped',
      reason: 'FACTORY_ADDRESS or ARB_RPC_URL not configured',
    });
  }

  try {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);

    // Get last indexed block
    const stateRows = await sql`
      SELECT last_block FROM indexer_state WHERE chain_id = ${CHAIN_ID}
    `;
    let fromBlock = stateRows.length > 0 ? parseInt(stateRows[0].last_block) + 1 : 0;

    // If first run and no state, start from deploy block (or recent)
    if (fromBlock === 0) {
      const currentBlock = await provider.getBlockNumber();
      fromBlock = Math.max(0, currentBlock - 10000); // Last ~10k blocks
    }

    const currentBlock = await provider.getBlockNumber();
    const toBlock = Math.min(fromBlock + BLOCK_BATCH, currentBlock);

    if (fromBlock > currentBlock) {
      return res.status(200).json({ status: 'up_to_date', block: currentBlock });
    }

    let processed = { markets: 0, trades: 0, resolutions: 0 };

    // ── Index MarketCreated events ──────────────────────────────────────────
    const createFilter = factory.filters.MarketCreated();
    const createEvents = await factory.queryFilter(createFilter, fromBlock, toBlock);

    for (const event of createEvents) {
      const { marketId, pool, question, category, endTime } = event.args;
      await sql`
        INSERT INTO protocol_markets (chain_id, factory_address, pool_address, market_id, question, category, end_time, tx_hash)
        VALUES (${CHAIN_ID}, ${factoryAddress}, ${pool}, ${marketId.toNumber()}, ${question}, ${category}, ${new Date(endTime.toNumber() * 1000).toISOString()}, ${event.transactionHash})
        ON CONFLICT (chain_id, market_id) DO NOTHING
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
      WHERE chain_id = ${CHAIN_ID} AND status = 'active'
    `;

    for (const pool of pools) {
      const amm = new ethers.Contract(pool.pool_address, AMM_ABI, provider);

      // SharesBought events
      const buyFilter = amm.filters.SharesBought();
      const buyEvents = await amm.queryFilter(buyFilter, fromBlock, toBlock);

      for (const event of buyEvents) {
        const { buyer, isYes, collateralIn, fee, sharesOut } = event.args;
        const collateral = parseFloat(ethers.utils.formatUnits(collateralIn, 6));
        const feeAmt = parseFloat(ethers.utils.formatUnits(fee, 6));
        const shares = parseFloat(ethers.utils.formatUnits(sharesOut, 6));
        const price = collateral > 0 ? collateral / shares : 0;

        await sql`
          INSERT INTO trades (market_id, trader, side, is_yes, collateral_amt, shares_amt, fee_amt, price_at_trade, tx_hash, block_number, log_index)
          VALUES (${pool.id}, ${buyer.toLowerCase()}, 'buy', ${isYes}, ${collateral}, ${shares}, ${feeAmt}, ${price}, ${event.transactionHash}, ${event.blockNumber}, ${event.logIndex})
          ON CONFLICT (tx_hash, log_index) DO NOTHING
        `;

        // Update position
        await upsertPosition(pool.id, buyer.toLowerCase(), isYes, shares, collateral, 'buy');
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

        await upsertPosition(pool.id, seller.toLowerCase(), isYes, -shares, -collateral, 'sell');
        processed.trades++;
      }

      // Snapshot current price from AMM reserves
      try {
        const reserveYes = parseFloat(ethers.utils.formatUnits(await amm.reserveYes(), 6));
        const reserveNo = parseFloat(ethers.utils.formatUnits(await amm.reserveNo(), 6));
        const total = reserveYes + reserveNo;
        if (total > 0) {
          const yesPrice = reserveNo / total; // CPMM: price = opposite_reserve / total
          const noPrice = reserveYes / total;
          await sql`
            INSERT INTO price_snapshots (market_id, yes_price, no_price, liquidity)
            VALUES (${pool.id}, ${yesPrice}, ${noPrice}, ${total})
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

async function upsertPosition(marketId, userAddress, isYes, sharesDelta, costDelta, side) {
  const yesCol = isYes ? 'yes_shares' : 'yes_shares';
  const noCol = isYes ? 'no_shares' : 'no_shares';

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
