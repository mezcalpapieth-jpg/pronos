/**
 * GET /api/protocol/u?username=<name>
 *
 * Public MVP on-chain profile. Looks up a username, reads that user's
 * Turnkey wallet, then shows protocol positions, trades, redemptions,
 * portfolio value, total won, and biggest single-market win. No cycles.
 */
import { ethers } from 'ethers';
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { ensureProtocolSchema } from '../_lib/protocol-schema.js';
import { buildProtocolUserProfilePayload } from '../_lib/protocol-leaderboard.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);
const schemaSql = neon(process.env.DATABASE_URL);
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function cleanAddress(value) {
  const s = String(value || '').trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(s) ? s : null;
}

function priceAt(row, index) {
  const prices = parseJsonb(row.s_prices, null);
  if (Array.isArray(prices) && prices[index] != null) return Number(prices[index]) || 0;
  if (index === 0) return Number(row.s_yes || 0);
  if (index === 1) return Number(row.s_no || 0);
  return 0;
}

async function readWalletBalance(address) {
  if (!address || !process.env.ONCHAIN_RPC_URL || !process.env.ONCHAIN_COLLATERAL_ADDRESS) return 0;
  try {
    const provider = new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
    const token = new ethers.Contract(process.env.ONCHAIN_COLLATERAL_ADDRESS, ERC20_ABI, provider);
    const decimals = Number(await token.decimals().catch(() => 18));
    const raw = await token.balanceOf(address);
    return roundMoney(ethers.utils.formatUnits(raw, decimals));
  } catch (error) {
    console.warn('[protocol/u] balanceOf failed', { message: error?.message });
    return 0;
  }
}

async function readWinMetrics(address) {
  const rows = await sql`
    SELECT r.market_id,
           SUM(r.payout) AS payout,
           MAX(m.question) AS question
    FROM redemptions r
    LEFT JOIN protocol_markets m ON m.id = r.market_id
    WHERE LOWER(r.user_address) = ${address}
    GROUP BY r.market_id
  `;
  let totalWon = 0;
  let biggestWin = 0;
  let biggestWinMarketId = null;
  let biggestWinQuestion = null;
  for (const row of rows) {
    const payout = roundMoney(row.payout);
    totalWon = roundMoney(totalWon + payout);
    if (payout > biggestWin) {
      biggestWin = payout;
      biggestWinMarketId = row.market_id;
      biggestWinQuestion = row.question || null;
    }
  }
  return { totalWon, biggestWin, biggestWinMarketId, biggestWinQuestion };
}

async function readActivePositions(address) {
  const active = [];
  const v2Rows = await sql`
    SELECT op.market_id, op.outcome_index, op.shares, op.total_cost,
           m.question, m.category, m.outcomes, m.end_time, m.pool_address,
           s.prices AS s_prices, s.yes_price AS s_yes, s.no_price AS s_no
    FROM outcome_positions op
    JOIN protocol_markets m ON m.id = op.market_id
    LEFT JOIN LATERAL (
      SELECT prices, yes_price, no_price
      FROM price_snapshots
      WHERE market_id = m.id
      ORDER BY snapshot_at DESC
      LIMIT 1
    ) s ON TRUE
    WHERE LOWER(op.user_address) = ${address}
      AND op.shares > 0
      AND COALESCE(m.status, 'active') = 'active'
    ORDER BY m.created_at DESC
    LIMIT 100
  `;
  for (const row of v2Rows) {
    const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
    const idx = Number(row.outcome_index);
    const price = priceAt(row, idx);
    const shares = Number(row.shares || 0);
    const currentValue = roundMoney(shares * price);
    active.push({
      marketId: row.market_id,
      question: row.question,
      category: row.category,
      outcomeIndex: idx,
      outcomeLabel: outcomes[idx] || `Opción ${idx + 1}`,
      shares,
      costBasis: roundMoney(row.total_cost),
      currentPrice: price,
      currentValue,
      unrealizedPnl: roundMoney(currentValue - Number(row.total_cost || 0)),
      endTime: row.end_time,
      poolAddress: row.pool_address,
    });
  }

  const v1Rows = await sql`
    SELECT p.market_id, p.yes_shares, p.no_shares, p.total_cost,
           m.question, m.category, m.outcomes, m.end_time, m.pool_address,
           s.yes_price AS s_yes, s.no_price AS s_no
    FROM positions p
    JOIN protocol_markets m ON m.id = p.market_id
    LEFT JOIN LATERAL (
      SELECT yes_price, no_price
      FROM price_snapshots
      WHERE market_id = m.id
      ORDER BY snapshot_at DESC
      LIMIT 1
    ) s ON TRUE
    WHERE LOWER(p.user_address) = ${address}
      AND (p.yes_shares > 0 OR p.no_shares > 0)
      AND COALESCE(m.status, 'active') = 'active'
    ORDER BY m.created_at DESC
    LIMIT 100
  `;
  for (const row of v1Rows) {
    const outcomes = parseJsonb(row.outcomes, ['Sí', 'No']);
    [
      [0, row.yes_shares, row.s_yes],
      [1, row.no_shares, row.s_no],
    ].forEach(([idx, rawShares, rawPrice]) => {
      const shares = Number(rawShares || 0);
      if (shares <= 0) return;
      const price = Number(rawPrice || 0);
      const currentValue = roundMoney(shares * price);
      active.push({
        marketId: row.market_id,
        question: row.question,
        category: row.category,
        outcomeIndex: idx,
        outcomeLabel: outcomes[idx] || `Opción ${idx + 1}`,
        shares,
        costBasis: roundMoney(row.total_cost),
        currentPrice: price,
        currentValue,
        unrealizedPnl: roundMoney(currentValue - Number(row.total_cost || 0)),
        endTime: row.end_time,
        poolAddress: row.pool_address,
      });
    });
  }
  return active;
}

async function readHistory(address) {
  const tradeRows = await sql`
    SELECT t.id, t.market_id, t.side, t.outcome_index, t.collateral_amt,
           t.shares_amt, t.price_at_trade, t.tx_hash, t.block_number,
           t.created_at, m.question, m.category
    FROM trades t
    LEFT JOIN protocol_markets m ON m.id = t.market_id
    WHERE LOWER(t.trader) = ${address}
    ORDER BY t.block_number DESC, t.log_index DESC
    LIMIT 100
  `;
  const redeemRows = await sql`
    SELECT r.id, r.market_id, r.outcome_index, r.shares, r.payout,
           r.tx_hash, r.block_number, r.created_at, m.question, m.category
    FROM redemptions r
    LEFT JOIN protocol_markets m ON m.id = r.market_id
    WHERE LOWER(r.user_address) = ${address}
    ORDER BY r.block_number DESC, r.log_index DESC
    LIMIT 100
  `;
  const rows = [
    ...tradeRows.map(row => ({
      id: row.id,
      marketId: row.market_id,
      question: row.question,
      category: row.category,
      side: row.side,
      outcomeIndex: row.outcome_index == null ? null : Number(row.outcome_index),
      collateral: roundMoney(row.collateral_amt),
      shares: Number(row.shares_amt || 0),
      priceAtTrade: row.price_at_trade == null ? null : Number(row.price_at_trade),
      txHash: row.tx_hash,
      blockNumber: Number(row.block_number || 0),
      createdAt: row.created_at,
    })),
    ...redeemRows.map(row => ({
      id: `r${row.id}`,
      marketId: row.market_id,
      question: row.question,
      category: row.category,
      side: 'redeem',
      outcomeIndex: row.outcome_index == null ? null : Number(row.outcome_index),
      collateral: roundMoney(row.payout),
      shares: Number(row.shares || 0),
      priceAtTrade: 1,
      txHash: row.tx_hash,
      blockNumber: Number(row.block_number || 0),
      createdAt: row.created_at,
    })),
  ];
  return rows.sort((a, b) => {
    const blockDiff = Number(b.blockNumber || 0) - Number(a.blockNumber || 0);
    if (blockDiff !== 0) return blockDiff;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  }).slice(0, 100);
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const raw = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!raw) return res.status(400).json({ error: 'username_required' });
  const username = raw.toLowerCase().slice(0, 32);

  try {
    await ensurePointsSchema(schemaSql);
    await ensureProtocolSchema(schemaSql);

    const userRows = await sql`
      SELECT username, wallet_address, created_at
      FROM points_users
      WHERE username = ${username}
      LIMIT 1
    `;
    const user = userRows[0];
    const address = cleanAddress(user?.wallet_address);
    if (!user || !address) return res.status(404).json({ error: 'user_not_found' });

    const [walletBalance, active, wins, history] = await Promise.all([
      readWalletBalance(address),
      readActivePositions(address),
      readWinMetrics(address),
      readHistory(address),
    ]);
    const openPositionValue = active.reduce((sum, row) => sum + Number(row.currentValue || 0), 0);

    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
    return res.status(200).json(buildProtocolUserProfilePayload({
      user: {
        username: user.username,
        walletAddress: address,
        joinedAt: user.created_at,
      },
      metrics: {
        walletBalance,
        openPositionValue,
        ...wins,
      },
      active,
      history,
    }));
  } catch (error) {
    console.error('[protocol/u] failed', { message: error?.message, code: error?.code });
    return res.status(500).json({ error: 'profile_failed' });
  }
}
