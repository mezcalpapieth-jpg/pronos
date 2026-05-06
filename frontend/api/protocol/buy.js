/**
 * POST /api/protocol/buy
 * Body: { marketId, outcomeIndex, collateral, minSharesOut?, maxAvgPrice? }
 *
 * MVP-only endpoint: dispatches an on-chain buy via Turnkey delegated
 * signing. The DB write is the indexer's job — this endpoint:
 *   1. Resolves the market from `protocol_markets` by DB row id
 *   2. Looks up the user's Turnkey suborg + wallet address
 *   3. Calls buyOnChain() which approves collateral (idempotent) +
 *      signs + broadcasts + parses the SharesBought event
 *   4. Returns { txHash, sharesOut, fee, blockNumber }
 *
 * The indexer (running every minute) sees SharesBought and writes
 * to `trades` + `outcome_positions` tables. Until that fires, the
 * UI relies on the response payload to render an optimistic update.
 *
 * This endpoint is on-chain ONLY. The off-chain points-app uses
 * /api/points/buy.js — completely separate ledger.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { buyOnChain } from '../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `protocol-buy:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

  const { marketId, outcomeIndex, collateral } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const amt = Number(collateral);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(amt) || amt <= 0)   return res.status(400).json({ error: 'invalid_amount' });

  try {
    // Resolve the market — must be active + on-chain (has pool_address).
    const marketRows = await sql`
      SELECT id, status, pool_address, outcomes, outcome_count, end_time, protocol_version
      FROM protocol_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (marketRows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = marketRows[0];
    if (m.status !== 'active') {
      return res.status(400).json({ error: 'market_closed' });
    }
    if (m.end_time && new Date(m.end_time) <= new Date()) {
      return res.status(400).json({ error: 'market_expired' });
    }
    const outcomes = parseJsonb(m.outcomes, ['Sí', 'No']);
    if (oi >= outcomes.length) {
      return res.status(400).json({ error: 'invalid_outcome_index' });
    }

    // Resolve the user's EVM wallet via the suborg → points_users mapping.
    // We share the users table with points-app for auth; only the DB
    // schemas (protocol_markets vs points_markets) are split.
    const userRows = await sql`
      SELECT wallet_address FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const ownerAddr = userRows[0]?.wallet_address;
    if (!ownerAddr) {
      return res.status(400).json({ error: 'wallet_not_found' });
    }

    const result = await buyOnChain({
      suborgId: session.sub,
      ownerAddr,
      market: { chain_address: m.pool_address, outcomes },
      outcomeIndex: oi,
      collateral: amt,
    });

    return res.status(200).json({
      ok: true,
      mode: 'protocol',
      sharesOut: result.sharesOut,
      fee: result.fee,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      // Indexer reconciles outcome_positions within ~1min; UI should
      // poll /api/protocol/positions or just optimistic-render.
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/buy] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'buy_failed' });
  }
}
