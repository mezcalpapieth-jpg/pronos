/**
 * POST /api/protocol/redeem
 * Body: { marketId, amount, requestId? }
 *
 * MVP-only on-chain redemption. After a market is resolved, holders
 * of the winning outcome can call AMM.redeem(amount) to burn winning
 * shares 1:1 for collateral (MXNB on Arbitrum One, MockMXNB on testnets).
 *
 * Both V1 (binary) and V2 (multi) AMMs use the same `redeem(uint256)`
 * signature — the contract knows which outcome is winning from its
 * own resolution state. We don't pass an outcome here.
 *
 * Indexer picks up the WinningsRedeemed event and writes to the
 * `redemptions` table.
 */
import { neon } from '@neondatabase/serverless';
import { protocolTradeRequest } from '../_lib/trade-request-runtime.js';
import { tradeError } from '../_lib/trade-requests.js';
import { validateTradePlan } from '../_lib/trade-request-validation.js';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { redeemOnChain } from '../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  res.setHeader('Cache-Control', 'private, no-store');
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
    const response = await protocolTradeRequest({
      req, session, action: 'redeem', payload: { marketId: mid, amount: amt },
      prepare: async ({ ownerAddr, chainId: expectedChainId }) => {
        const marketRows = await sql`
          SELECT id, status, pool_address, chain_id
          FROM protocol_markets
          WHERE id = ${mid}
          LIMIT 1
        `;
        if (marketRows.length === 0) {
          throw tradeError('market_not_found', 404);
        }
        const m = marketRows[0];
        if (expectedChainId && Number(m.chain_id) !== expectedChainId) throw tradeError('trade_wrong_chain', 400);
        if (m.status !== 'resolved') {
          throw tradeError('market_not_resolved', 400);
        }

        return { protocolMarketId: mid, chainId: Number(m.chain_id), suborgId: session.sub, ownerAddr, market: { chain_address: m.pool_address }, amount: amt };
      },
      validate: plan => validateTradePlan({ sql, action: 'redeem', plan }),
      execute: async (plan, execution) => {
        const result = await redeemOnChain({ ...plan, execution });
        return { ok: true, mode: 'protocol', payout: plan.amount, txHash: result.txHash, blockNumber: result.blockNumber };
      },
    });
    return res.status(response.httpStatus).json(response.body);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/redeem] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'redeem_failed' });
  }
}
