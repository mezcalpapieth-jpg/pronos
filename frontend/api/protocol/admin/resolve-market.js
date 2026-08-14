/**
 * POST /api/protocol/admin/resolve-market
 * Body: { marketId, winningOutcomeIndex }
 *
 * MVP-only on-chain market resolution. Looks up the protocol_markets
 * row by DB id, calls factory.resolveMarket(chainMarketId, outcome)
 * via Turnkey delegated signing using the resolver suborg/wallet.
 *
 * The resolver wallet must equal factory.resolver() on-chain. By
 * default that's the deployer; mainnet operators can reassign it
 * to a Gnosis Safe via factory.setResolver(safe).
 *
 * Env vars (in priority order — first set wins):
 *   ONCHAIN_RESOLVER_SUBORG_ID  /  ONCHAIN_DEPLOYER_SUBORG_ID
 *   ONCHAIN_RESOLVER_ADDRESS    /  ONCHAIN_DEPLOYER_ADDRESS
 *
 * Lets ops keep the resolver separate from the deployer if they
 * want different keys for create vs resolve, while staying
 * single-key-friendly during testnet.
 *
 * No DB write here — indexer picks up MarketResolved within ~1
 * minute and updates protocol_markets.status='resolved'.
 */
import { neon } from '@neondatabase/serverless';
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import { resolveMarketOnChain, isOnchainReady } from '../../_lib/onchain-trader.js';

const sql = neon(process.env.DATABASE_READ_URL || process.env.DATABASE_URL);

export default async function handler(req, res) {
  const cors = applyCors(req, res, { methods: 'POST, OPTIONS', credentials: true });
  if (cors) return cors;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const admin = requirePointsAdmin(req, res);
  if (!admin) return;

  if (!isOnchainReady()) {
    return res.status(503).json({
      error: 'onchain_not_enabled',
      detail: 'set TURNKEY_POLICIES_ENABLED + ONCHAIN_RPC_URL + ONCHAIN_COLLATERAL_ADDRESS',
    });
  }

  const resolverSuborgId = process.env.ONCHAIN_RESOLVER_SUBORG_ID
    || process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
  const resolverAddr = process.env.ONCHAIN_RESOLVER_ADDRESS
    || process.env.ONCHAIN_DEPLOYER_ADDRESS;
  if (!resolverSuborgId || !resolverAddr) {
    return res.status(503).json({
      error: 'resolver_not_configured',
      detail: 'set ONCHAIN_RESOLVER_SUBORG_ID + ONCHAIN_RESOLVER_ADDRESS (or fall back to ONCHAIN_DEPLOYER_*)',
    });
  }

  const { marketId, winningOutcomeIndex } = req.body || {};
  const mid = parseInt(marketId, 10);
  const oi = parseInt(winningOutcomeIndex, 10);
  if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'invalid_market_id' });
  if (!Number.isInteger(oi) || oi < 0)     return res.status(400).json({ error: 'invalid_outcome' });

  try {
    const rows = await sql`
      SELECT id, status, market_id, factory_address, protocol_version, outcome_count
      FROM protocol_markets
      WHERE id = ${mid}
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(404).json({ error: 'market_not_found' });
    }
    const m = rows[0];
    if (m.status !== 'active') {
      return res.status(400).json({ error: 'market_not_active' });
    }
    const outcomeCount = Number(m.outcome_count) || 2;
    if (oi >= outcomeCount) {
      return res.status(400).json({
        error: 'invalid_outcome',
        detail: `market has ${outcomeCount} outcomes, index ${oi} out of range`,
      });
    }
    if (!m.factory_address || !m.market_id) {
      return res.status(500).json({ error: 'market_missing_chain_metadata' });
    }

    const result = await resolveMarketOnChain({
      resolverSuborgId,
      resolverAddr,
      factoryAddress: m.factory_address,
      factoryVariant: m.protocol_version === 'v2' ? 'v2' : 'v1',
      marketId: m.market_id,
      outcome: oi,
    });

    return res.status(200).json({
      ok: true,
      marketId: result.marketId,
      outcome: result.outcome,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      chainId: result.chainId,
      factoryVariant: result.factoryVariant,
    });
  } catch (e) {
    if (e?.status && typeof e?.message === 'string') {
      return res.status(e.status).json({
        error: e.message,
        detail: e.detail || null,
      });
    }
    console.error('[protocol/admin/resolve-market] failed', {
      message: e?.message, code: e?.code,
    });
    return res.status(500).json({ error: 'resolve_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
