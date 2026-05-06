/**
 * POST /api/protocol/admin/create-market
 * Body: {
 *   question, category, endTime,
 *   outcomes: string[],            // 2..8
 *   seedAmount,                    // collateral units (USDC/MXNB)
 *   resolutionSource?: string,
 *   ammMode?: 'unified' | 'parallel',
 * }
 *
 * MVP-only on-chain market deployment. Calls MarketFactory.createMarket
 * (V1 for binary, V2 for 3..8, parallel-binary loop for 'parallel' mode)
 * via Turnkey delegated signing using the deployer suborg + wallet.
 *
 * No DB write — the indexer picks up MarketCreated within ~1 minute
 * and writes to `protocol_markets`. Admin sees the new market in the
 * grid after the next indexer tick.
 *
 * Off-chain points-app market creation lives in
 * /api/points/admin/create-market.js — unrelated.
 */
import { applyCors } from '../../_lib/cors.js';
import { requirePointsAdmin } from '../../_lib/points-admin.js';
import {
  deployMarketOnChain,
  deployParallelBinaryOnChain,
  isOnchainReady,
} from '../../_lib/onchain-trader.js';

const ALLOWED_CATEGORIES = new Set([
  'general', 'mexico', 'politica', 'deportes', 'finanzas', 'crypto', 'musica',
]);

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

  const deployerSuborgId = process.env.ONCHAIN_DEPLOYER_SUBORG_ID;
  const deployerAddr = process.env.ONCHAIN_DEPLOYER_ADDRESS;
  if (!deployerSuborgId || !deployerAddr) {
    return res.status(503).json({
      error: 'deployer_not_configured',
      detail: 'set ONCHAIN_DEPLOYER_SUBORG_ID + ONCHAIN_DEPLOYER_ADDRESS',
    });
  }

  const {
    question, category, endTime, outcomes, seedAmount,
    resolutionSource, ammMode,
  } = req.body || {};

  if (typeof question !== 'string' || question.trim().length < 8) {
    return res.status(400).json({ error: 'invalid_question' });
  }
  if (!ALLOWED_CATEGORIES.has(category)) {
    return res.status(400).json({ error: 'invalid_category' });
  }
  if (!Array.isArray(outcomes) || outcomes.length < 2 || outcomes.length > 8) {
    return res.status(400).json({ error: 'outcome_count_out_of_range' });
  }
  if (!outcomes.every(o => typeof o === 'string' && o.trim().length > 0)) {
    return res.status(400).json({ error: 'invalid_outcomes' });
  }
  const normalizedOutcomes = outcomes.map(o => o.trim());
  const lowerSet = new Set(normalizedOutcomes.map(o => o.toLowerCase()));
  if (lowerSet.size !== normalizedOutcomes.length) {
    return res.status(400).json({ error: 'duplicate_outcomes' });
  }
  const seed = Number(seedAmount);
  if (!Number.isFinite(seed) || seed < 100) {
    return res.status(400).json({ error: 'seed_too_small' });
  }
  const endDate = endTime ? new Date(endTime) : null;
  if (!endDate || isNaN(endDate.getTime()) || endDate <= new Date()) {
    return res.status(400).json({ error: 'invalid_end_time' });
  }
  const mode = ammMode === 'parallel' ? 'parallel' : 'unified';
  const resolverSrc = (typeof resolutionSource === 'string' && resolutionSource.trim())
    ? resolutionSource.trim()
    : 'Pronos admin';

  try {
    if (mode === 'parallel') {
      const result = await deployParallelBinaryOnChain({
        deployerSuborgId,
        deployerAddr,
        parentQuestion: question.trim(),
        category,
        outcomeLabels: normalizedOutcomes,
        endTime: endDate.toISOString(),
        resolutionSource: resolverSrc,
        seedAmountPerLeg: seed,
      });
      return res.status(200).json({
        ok: true,
        ammMode: 'parallel',
        chainId: result.chainId,
        legs: result.legs,
      });
    }

    const result = await deployMarketOnChain({
      deployerSuborgId,
      deployerAddr,
      question: question.trim(),
      category,
      outcomeCount: normalizedOutcomes.length,
      outcomeLabels: normalizedOutcomes,
      endTime: endDate.toISOString(),
      resolutionSource: resolverSrc,
      seedAmount: seed,
    });
    return res.status(200).json({
      ok: true,
      ammMode: 'unified',
      marketId: result.marketId,
      marketAddress: result.marketAddress,
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
        partialLegs: e.partialLegs || null,
        txHash: e.txHash || null,
      });
    }
    console.error('[protocol/admin/create-market] failed', {
      message: e?.message, code: e?.code,
    });
    return res.status(500).json({ error: 'create_failed', detail: e?.message?.slice(0, 240) || null });
  }
}
