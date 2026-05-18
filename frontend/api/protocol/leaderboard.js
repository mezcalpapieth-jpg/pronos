/**
 * GET /api/protocol/leaderboard
 *   ?q=<username search>
 *   ?limit=10
 *
 * MVP-only on-chain leaderboards. No points cycles, no MXNP reset logic:
 * users rank by current MXNB portfolio value, total MXNB won through
 * redemptions, and biggest single-market MXNB win.
 */
import { ethers } from 'ethers';
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { ensurePointsSchema } from '../_lib/points-schema.js';
import { ensureProtocolSchema } from '../_lib/protocol-schema.js';
import { buildProtocolLeaderboardPayload } from '../_lib/protocol-leaderboard.js';

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

function addToMap(map, key, value) {
  if (!key) return;
  map.set(key, roundMoney((map.get(key) || 0) + Number(value || 0)));
}

function priceAt(row, index) {
  const prices = parseJsonb(row.s_prices, null);
  if (Array.isArray(prices) && prices[index] != null) return Number(prices[index]) || 0;
  if (index === 0) return Number(row.s_yes || 0);
  if (index === 1) return Number(row.s_no || 0);
  return 0;
}

async function listUsers(query) {
  const q = String(query || '').trim().toLowerCase().slice(0, 32);
  const like = `%${q}%`;
  if (q) {
    return sql`
      SELECT username, wallet_address, created_at
      FROM points_users
      WHERE username IS NOT NULL
        AND wallet_address IS NOT NULL
        AND LOWER(username) LIKE ${like}
      ORDER BY username ASC
      LIMIT 500
    `;
  }
  return sql`
    SELECT username, wallet_address, created_at
    FROM points_users
    WHERE username IS NOT NULL
      AND wallet_address IS NOT NULL
    ORDER BY created_at ASC
    LIMIT 500
  `;
}

async function readWalletBalances(addresses) {
  const out = new Map();
  if (!process.env.ONCHAIN_RPC_URL || !process.env.ONCHAIN_COLLATERAL_ADDRESS || addresses.length === 0) {
    return out;
  }
  try {
    const provider = new ethers.providers.JsonRpcProvider(process.env.ONCHAIN_RPC_URL);
    const token = new ethers.Contract(process.env.ONCHAIN_COLLATERAL_ADDRESS, ERC20_ABI, provider);
    const decimals = Number(await token.decimals().catch(() => 18));
    await Promise.all(addresses.map(async address => {
      try {
        const raw = await token.balanceOf(address);
        out.set(address, roundMoney(ethers.utils.formatUnits(raw, decimals)));
      } catch {
        out.set(address, 0);
      }
    }));
  } catch (error) {
    console.warn('[protocol/leaderboard] balanceOf failed', { message: error?.message });
  }
  return out;
}

async function readOpenPositionValues(addresses) {
  const out = new Map();
  if (addresses.length === 0) return out;

  const v2Rows = await sql`
    SELECT LOWER(op.user_address) AS user_address, op.outcome_index, op.shares,
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
    WHERE LOWER(op.user_address) = ANY(${addresses}::text[])
      AND op.shares > 0
      AND COALESCE(m.status, 'active') = 'active'
  `;

  for (const row of v2Rows) {
    const idx = Number(row.outcome_index);
    addToMap(out, row.user_address, Number(row.shares || 0) * priceAt(row, idx));
  }

  const v1Rows = await sql`
    SELECT LOWER(p.user_address) AS user_address, p.yes_shares, p.no_shares,
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
    WHERE LOWER(p.user_address) = ANY(${addresses}::text[])
      AND (p.yes_shares > 0 OR p.no_shares > 0)
      AND COALESCE(m.status, 'active') = 'active'
  `;

  for (const row of v1Rows) {
    addToMap(out, row.user_address, Number(row.yes_shares || 0) * Number(row.s_yes || 0));
    addToMap(out, row.user_address, Number(row.no_shares || 0) * Number(row.s_no || 0));
  }
  return out;
}

async function readWinMetrics(addresses) {
  const out = new Map();
  if (addresses.length === 0) return out;
  const rows = await sql`
    SELECT LOWER(r.user_address) AS user_address,
           r.market_id,
           SUM(r.payout) AS payout,
           MAX(m.question) AS question
    FROM redemptions r
    LEFT JOIN protocol_markets m ON m.id = r.market_id
    WHERE LOWER(r.user_address) = ANY(${addresses}::text[])
    GROUP BY LOWER(r.user_address), r.market_id
  `;
  for (const row of rows) {
    const address = row.user_address;
    const payout = roundMoney(row.payout);
    const current = out.get(address) || {
      totalWon: 0,
      biggestWin: 0,
      biggestWinMarketId: null,
      biggestWinQuestion: null,
    };
    current.totalWon = roundMoney(current.totalWon + payout);
    if (payout > current.biggestWin) {
      current.biggestWin = payout;
      current.biggestWinMarketId = row.market_id;
      current.biggestWinQuestion = row.question || null;
    }
    out.set(address, current);
  }
  return out;
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'GET, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    await ensurePointsSchema(schemaSql);
    await ensureProtocolSchema(schemaSql);

    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const limitRaw = Number.parseInt(req.query.limit, 10);
    const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 10, 50));
    const users = await listUsers(query);
    const addresses = Array.from(new Set(users.map(u => cleanAddress(u.wallet_address)).filter(Boolean)));
    const [walletBalances, openValues, winMetrics] = await Promise.all([
      readWalletBalances(addresses),
      readOpenPositionValues(addresses),
      readWinMetrics(addresses),
    ]);
    const rows = users.map(user => {
      const address = cleanAddress(user.wallet_address);
      const wins = winMetrics.get(address) || {};
      return {
        username: user.username,
        walletAddress: address,
        joinedAt: user.created_at,
        walletBalance: walletBalances.get(address) || 0,
        openPositionValue: openValues.get(address) || 0,
        totalWon: wins.totalWon || 0,
        biggestWin: wins.biggestWin || 0,
        biggestWinMarketId: wins.biggestWinMarketId || null,
        biggestWinQuestion: wins.biggestWinQuestion || null,
      };
    });

    res.setHeader('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
    return res.status(200).json(buildProtocolLeaderboardPayload({ users: rows, query, limit }));
  } catch (error) {
    console.error('[protocol/leaderboard] failed', { message: error?.message, code: error?.code });
    return res.status(500).json({ error: 'leaderboard_failed' });
  }
}
