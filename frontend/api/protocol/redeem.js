/**
 * POST /api/protocol/redeem
 * Body: { marketId, amount }
 *
 * MVP-only on-chain redemption. After a market is resolved, holders
 * of the winning outcome can call AMM.redeem(amount) to burn winning
 * shares 1:1 for collateral (USDC on Sepolia, MXNB on mainnet).
 *
 * Both V1 (binary) and V2 (multi) AMMs use the same `redeem(uint256)`
 * signature — the contract knows which outcome is winning from its
 * own resolution state. We don't pass an outcome here.
 *
 * Indexer picks up the WinningsRedeemed event and writes to the
 * `redemptions` table.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { redeemOnChain } from '../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const limited = rateLimit(req, res, {
    key: `protocol-redeem:${clientIp(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (limited) return;

  const session = requireSession(req, res);
  if (!session) return;
  if (!session.sub) return res.status(400).json({ error: 'suborg_required' });

  const { marketId, amount } = req.body || {};
  const mid = parseInt(marketId, 10);
  const amt = Number(amount);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isFinite(amt) || amt <= 0)   return res.status(400).json({ error: 'invalid_amount' });

  try {
    const marketRows = await sql`
      SELECT id, status, pool_address
      FROM protocol_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (marketRows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = marketRows[0];
    if (m.status !== 'resolved') {
      return res.status(400).json({ error: 'market_not_resolved' });
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

    const result = await redeemOnChain({
      suborgId: session.sub,
      ownerAddr,
      market: { chain_address: m.pool_address },
      amount: amt,
    });

    return res.status(200).json({
      ok: true,
      mode: 'protocol',
      payout: amt, // 1:1 with the burned winning shares
      txHash: result.txHash,
      blockNumber: result.blockNumber,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/redeem] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'redeem_failed' });
  }
}
