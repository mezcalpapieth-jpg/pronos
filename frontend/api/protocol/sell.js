/**
 * POST /api/protocol/sell
 * Body: { marketId, outcomeIndex, shares, minCollateralOut? }
 *
 * MVP-only on-chain sell. Same shape as /api/protocol/buy.js — the
 * endpoint is a thin wrapper over sellOnChain; indexer reconciles
 * outcome_positions from the SharesSold event.
 *
 * Position pre-check is skipped here: if the user doesn't actually
 * hold the shares, the on-chain CPMM reverts on burn() and the
 * caller surfaces tx_reverted with the exact reason. Adding a DB
 * pre-check would just race the indexer's lag.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { sellOnChain } from '../_lib/onchain-trader.js';

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
    key: `protocol-sell:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

  const { marketId, outcomeIndex, shares } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const n   = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0)       return res.status(400).json({ error: 'invalid_shares' });

  try {
    const marketRows = await sql`
      SELECT id, status, pool_address, outcomes, end_time
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

    const userRows = await sql`
      SELECT wallet_address FROM points_users
      WHERE turnkey_sub_org_id = ${session.sub}
      LIMIT 1
    `;
    const ownerAddr = userRows[0]?.wallet_address;
    if (!ownerAddr) {
      return res.status(400).json({ error: 'wallet_not_found' });
    }

    const result = await sellOnChain({
      suborgId: session.sub,
      ownerAddr,
      market: { chain_address: m.pool_address, outcomes },
      outcomeIndex: oi,
      shares: n,
    });

    return res.status(200).json({
      ok: true,
      mode: 'protocol',
      collateralOut: result.collateralOut,
      fee: result.fee,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/sell] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'sell_failed' });
  }
}
