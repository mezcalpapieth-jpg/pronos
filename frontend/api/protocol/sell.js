/**
 * POST /api/protocol/sell
 * Body: { marketId, outcomeIndex, shares, minCollateralOut?, requestId? }
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
import { protocolTradeRequest } from '../_lib/trade-request-runtime.js';
import { tradeError } from '../_lib/trade-requests.js';
import { validateTradePlan } from '../_lib/trade-request-validation.js';
import { assertTournamentTradingOpen } from '../_lib/sepolia-tournament-season.js';
import { applyCors } from '../_lib/cors.js';
import { requireSession } from '../_lib/session.js';
import { rateLimit, clientIp } from '../_lib/rate-limit.js';
import { quoteSellOnChain, sellOnChain } from '../_lib/onchain-trader.js';
import {
  defaultMinCollateralOut,
  enforceProtocolSellSlippage,
  optionalFiniteNumber,
} from '../_lib/protocol-trade-guards.js';

const sql = neon(process.env.DATABASE_URL);

function parseJsonb(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  res.setHeader('Cache-Control', 'private, no-store');
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

  const { marketId, outcomeIndex, shares, minCollateralOut } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi  = parseInt(outcomeIndex, 10);
  const n   = Number(shares);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0)    return res.status(400).json({ error: 'invalid_outcome_index' });
  if (!Number.isFinite(n) || n <= 0)       return res.status(400).json({ error: 'invalid_shares' });

  try {
    const response = await protocolTradeRequest({
      req, session, action: 'sell', payload: { marketId: mid, outcomeIndex: oi, shares: n, minCollateralOut: minCollateralOut ?? null, quoteReference: req.body?.quoteReference ?? null },
      prepare: async ({ ownerAddr, chainId: expectedChainId }) => {
        await assertTournamentTradingOpen();
        const marketRows = await sql`
          SELECT id, status, pool_address, outcomes, end_time, chain_id
          FROM protocol_markets
          WHERE id = ${mid}
          LIMIT 1
        `;
        if (marketRows.length === 0) {
          throw tradeError('market_not_found', 404);
        }
        const m = marketRows[0];
        if (expectedChainId && Number(m.chain_id) !== expectedChainId) throw tradeError('trade_wrong_chain', 400);
        if (m.status !== 'active') {
          throw tradeError('market_closed', 400);
        }
        if (!m.pool_address) {
          throw tradeError('market_missing_pool', 400);
        }
        if (m.end_time && new Date(m.end_time) <= new Date()) {
          throw tradeError('market_expired', 400);
        }
        const outcomes = parseJsonb(m.outcomes, ['Sí', 'No']);
        if (oi >= outcomes.length) {
          throw tradeError('invalid_outcome_index', 400);
        }
        const quote = await quoteSellOnChain({
          market: { chain_address: m.pool_address, outcomes },
          outcomeIndex: oi,
          shares: n,
        });
        enforceProtocolSellSlippage({ quote, minCollateralOut });
        const txMinCollateralOut = optionalFiniteNumber(minCollateralOut)
          ?? defaultMinCollateralOut(quote);

        return { protocolMarketId: mid, chainId: Number(m.chain_id), suborgId: session.sub, ownerAddr, market: { chain_address: m.pool_address, outcomes }, outcomeIndex: oi, shares: n, minCollateralOut: txMinCollateralOut };
      },
      validate: plan => validateTradePlan({ sql, action: 'sell', plan }),
      execute: async (plan, execution) => {
        const result = await sellOnChain({ ...plan, execution });
        return { ok: true, mode: 'protocol', collateralOut: result.collateralOut, fee: result.fee, txHash: result.txHash, blockNumber: result.blockNumber };
      },
    });
    return res.status(response.httpStatus).json(response.body);
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({ error: e.message, detail: e.detail });
    }
    console.error('[protocol/sell] failed', { message: e?.message, code: e?.code });
    return res.status(500).json({ error: 'sell_failed' });
  }
}
